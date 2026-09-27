-- ============================================================================
-- Migration 0004: Transactional functions (SECURITY DEFINER)
-- These are the ONLY way sales/bills/stock/audit rows get written for
-- non-trivial operations, so business rules and audit logging cannot be
-- bypassed by calling PostgREST table endpoints directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Audit logging helper — always runs as owner, so it works regardless of the
-- caller's RLS grants, and callers (including admin UI) cannot skip it.
-- ---------------------------------------------------------------------------
create or replace function log_audit_event(
  p_action text,
  p_entity_table text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_success boolean default true,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role;
begin
  select role into v_role from profiles where id = auth.uid();
  insert into audit_logs (actor_id, actor_role, action, entity_table, entity_id, before_value, after_value, success, error_message)
  values (auth.uid(), v_role, p_action, p_entity_table, p_entity_id, p_before, p_after, p_success, p_error);
end;
$$;

-- Only SECURITY DEFINER functions in this file call log_audit_event; there is
-- no grant of audit_logs INSERT to any table role (see 0003), so this is the
-- sole write path.
grant execute on function log_audit_event to authenticated;

-- ---------------------------------------------------------------------------
-- register_sale(): atomic sale creation. Client calls this RPC — never a raw
-- INSERT into sales/sale_items. Amount is always qty*sold_inr (generated
-- column); this function does not trust any client-submitted total.
-- ---------------------------------------------------------------------------
create type sale_item_input as (
  product_id uuid,
  qty numeric,
  sold_inr numeric
);

create or replace function register_sale(
  p_sale_date date,
  p_customer_id uuid,
  p_customer_ref text,
  p_payment_mode payment_mode,
  p_shift shift_type,
  p_items sale_item_input[],
  p_allow_negative_stock boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id uuid;
  v_item sale_item_input;
  v_product products%rowtype;
  v_current_stock numeric;
  v_low_stock_threshold numeric := 5;
begin
  if not is_active_user() then
    raise exception 'Account is inactive';
  end if;
  if array_length(p_items, 1) is null or array_length(p_items, 1) = 0 then
    raise exception 'Sale must contain at least one item';
  end if;

  insert into sales (sale_date, customer_id, customer_ref, payment_mode, shift, created_by)
  values (p_sale_date, p_customer_id, p_customer_ref, p_payment_mode, p_shift, auth.uid())
  returning id into v_sale_id;

  foreach v_item in array p_items loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception 'Invalid quantity for product %', v_item.product_id;
    end if;
    if v_item.sold_inr is null or v_item.sold_inr < 0 then
      raise exception 'Invalid selling price for product %', v_item.product_id;
    end if;

    select * into v_product from products where id = v_item.product_id and is_active;
    if not found then
      raise exception 'Product % not found or inactive', v_item.product_id;
    end if;

    -- Stock guard (Stock Register closing balance recomputed live)
    select coalesce(sum(qty_delta), 0) into v_current_stock
    from stock_movements where product_id = v_item.product_id;

    if v_current_stock - v_item.qty < 0 and not p_allow_negative_stock then
      raise exception 'Insufficient stock for %: have %, need %', v_product.product_name, v_current_stock, v_item.qty;
    end if;

    insert into sale_items (sale_id, product_id, item_name_snap, qty, sold_inr, mrp_snap, cost_snap)
    values (v_sale_id, v_item.product_id, v_product.product_name, v_item.qty, v_item.sold_inr, v_product.mrp, v_product.cost_per_unit);

    insert into stock_movements (product_id, movement_type, qty_delta, reference_table, reference_id, created_by)
    values (v_item.product_id, 'SALE', -v_item.qty, 'sales', v_sale_id, auth.uid());

    if v_current_stock - v_item.qty <= v_low_stock_threshold then
      perform log_audit_event('stock.low_warning', 'products', v_item.product_id::text, null,
        jsonb_build_object('remaining', v_current_stock - v_item.qty, 'threshold', v_low_stock_threshold));
    end if;
  end loop;

  if p_payment_mode = 'CREDIT' then
    if p_customer_id is null then
      raise exception 'Customer is required for a credit sale';
    end if;
    insert into credit_ledger (customer_id, sale_id, entry_type, amount, created_by)
    select p_customer_id, v_sale_id, 'CHARGE', sum(amount), auth.uid()
    from sale_items where sale_id = v_sale_id;
  end if;

  perform log_audit_event('sale.create', 'sales', v_sale_id::text, null,
    (select jsonb_build_object('sale_id', v_sale_id, 'items', count(*), 'payment_mode', p_payment_mode) from sale_items where sale_id = v_sale_id));

  return v_sale_id;
exception when others then
  perform log_audit_event('sale.create', 'sales', null, null, null, false, sqlerrm);
  raise;
end;
$$;

grant execute on function register_sale to authenticated;

-- ---------------------------------------------------------------------------
-- record_credit_payment(): a customer pays down their credit balance
-- ---------------------------------------------------------------------------
create or replace function record_credit_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;
  if not exists (
    select 1 from customers c
    where c.id = p_customer_id and (c.created_by = auth.uid() or is_admin())
  ) then
    raise exception 'Not authorized for this customer';
  end if;

  insert into credit_ledger (customer_id, entry_type, amount, note, created_by)
  values (p_customer_id, 'PAYMENT', -abs(p_amount), p_note, auth.uid())
  returning id into v_id;

  perform log_audit_event('credit.payment', 'credit_ledger', v_id::text, null,
    jsonb_build_object('customer_id', p_customer_id, 'amount', p_amount));

  return v_id;
end;
$$;

grant execute on function record_credit_payment to authenticated;

-- ---------------------------------------------------------------------------
-- generate_bill(): backend-authoritative bill numbering + snapshot of totals.
-- Bill numbers are NEVER produced client-side.
-- ---------------------------------------------------------------------------
create or replace function next_bill_number(p_bill_date date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_key text;
  v_seq bigint;
begin
  select coalesce(value->>'bill_prefix', 'SSS') into v_prefix from app_settings where key = 'store_profile';
  v_key := to_char(p_bill_date, 'YYYYMM');

  insert into bill_counters (counter_key, next_seq) values (v_key, 2)
  on conflict (counter_key) do update set next_seq = bill_counters.next_seq + 1
  returning next_seq - 1 into v_seq;

  return v_prefix || '-' || v_key || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function generate_bill(p_sale_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale sales%rowtype;
  v_bill_id uuid;
  v_bill_number text;
  v_subtotal numeric;
  v_mrp_total numeric;
begin
  select * into v_sale from sales where id = p_sale_id;
  if not found then
    raise exception 'Sale not found';
  end if;
  if v_sale.created_by <> auth.uid() and not is_admin() then
    raise exception 'Not authorized for this sale';
  end if;
  if v_sale.bill_id is not null then
    return v_sale.bill_id; -- idempotent: bill already exists
  end if;

  select sum(amount), sum(mrp_snap * qty) into v_subtotal, v_mrp_total
  from sale_items where sale_id = p_sale_id;

  v_bill_number := next_bill_number(v_sale.sale_date);

  insert into bills (bill_number, sale_id, customer_id, bill_date, subtotal, total_amount, saved_amount, payment_mode, created_by)
  values (v_bill_number, p_sale_id, v_sale.customer_id, v_sale.sale_date, v_subtotal, v_subtotal,
          greatest(coalesce(v_mrp_total,0) - coalesce(v_subtotal,0), 0), v_sale.payment_mode, auth.uid())
  returning id into v_bill_id;

  update sales set bill_id = v_bill_id where id = p_sale_id;

  perform log_audit_event('bill.generate', 'bills', v_bill_id::text, null,
    jsonb_build_object('bill_number', v_bill_number, 'sale_id', p_sale_id, 'total', v_subtotal));

  return v_bill_id;
end;
$$;

grant execute on function generate_bill to authenticated;

-- ---------------------------------------------------------------------------
-- Admin-only reporting RPCs (bypass the revoked views safely, with an
-- explicit admin check inside the function body — belt and suspenders)
-- ---------------------------------------------------------------------------
create or replace function get_product_analysis()
returns setof v_product_analysis
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;
  return query select * from v_product_analysis;
end;
$$;

grant execute on function get_product_analysis to authenticated;

create or replace function get_stock_register()
returns setof v_stock_register
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;
  return query select * from v_stock_register;
end;
$$;

grant execute on function get_stock_register to authenticated;

create or replace function get_monthly_summary()
returns setof v_monthly_summary
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;
  return query select * from v_monthly_summary;
end;
$$;

grant execute on function get_monthly_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: record a purchase (atomic header + items + stock movement)
-- ---------------------------------------------------------------------------
create type purchase_item_input as (
  product_id uuid,
  qty numeric,
  amount numeric
);

create or replace function record_purchase(
  p_purchase_date date,
  p_supplier text,
  p_items purchase_item_input[],
  p_paid_credit paid_credit default 'PAID'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_purchase_id uuid;
  v_item purchase_item_input;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  insert into purchases (purchase_date, supplier, created_by) values (p_purchase_date, p_supplier, auth.uid())
  returning id into v_purchase_id;

  foreach v_item in array p_items loop
    if v_item.qty <= 0 or v_item.amount < 0 then
      raise exception 'Invalid purchase item values';
    end if;

    insert into purchase_items (purchase_id, product_id, item_name_snap, qty, amount, paid_credit)
    select v_purchase_id, v_item.product_id, p.product_name, v_item.qty, v_item.amount, p_paid_credit
    from products p where p.id = v_item.product_id;

    insert into stock_movements (product_id, movement_type, qty_delta, reference_table, reference_id, created_by)
    values (v_item.product_id, 'PURCHASE', v_item.qty, 'purchases', v_purchase_id, auth.uid());
  end loop;

  perform log_audit_event('purchase.create', 'purchases', v_purchase_id::text, null,
    jsonb_build_object('supplier', p_supplier, 'items', array_length(p_items,1)));

  return v_purchase_id;
end;
$$;

grant execute on function record_purchase to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: void a sale (reversal, not hard delete) — reinstates stock
-- ---------------------------------------------------------------------------
create or replace function void_sale(p_sale_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item record;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  update sales set is_voided = true, void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
  where id = p_sale_id and not is_voided;

  if not found then
    raise exception 'Sale not found or already voided';
  end if;

  for v_item in select product_id, qty from sale_items where sale_id = p_sale_id loop
    insert into stock_movements (product_id, movement_type, qty_delta, reference_table, reference_id, note, created_by)
    values (v_item.product_id, 'ADJUSTMENT', v_item.qty, 'sales', p_sale_id, 'Reversal for voided sale: ' || p_reason, auth.uid());
  end loop;

  perform log_audit_event('sale.void', 'sales', p_sale_id::text, null, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function void_sale to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: promote/demote a user's role (audited, cannot happen via raw UPDATE)
-- ---------------------------------------------------------------------------
create or replace function set_user_role(p_user_id uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before app_role;
begin
  if not is_admin() then
    raise exception 'Admin access required';
  end if;

  select role into v_before from profiles where id = p_user_id;
  update profiles set role = p_role where id = p_user_id;

  perform log_audit_event('user.role_change', 'profiles', p_user_id::text,
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));
end;
$$;

grant execute on function set_user_role to authenticated;

-- ---------------------------------------------------------------------------
-- Login/logout audit hooks are emitted from the client immediately after
-- auth state changes (see src/lib/auth.ts), calling this narrow RPC:
-- ---------------------------------------------------------------------------
create or replace function log_auth_event(p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_action not in ('login', 'logout') then
    raise exception 'Invalid auth event';
  end if;
  perform log_audit_event(p_action, 'profiles', auth.uid()::text);
end;
$$;

grant execute on function log_auth_event to authenticated;

-- ---------------------------------------------------------------------------
-- Export audit: called by the frontend right before it triggers an XLSX
-- download, so every export is logged even though the file itself is built
-- client-side from already-authorized data.
-- ---------------------------------------------------------------------------
create or replace function log_export_event(p_export_type text, p_row_count int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform log_audit_event('export.' || p_export_type, null, null, null,
    jsonb_build_object('row_count', p_row_count));
end;
$$;

grant execute on function log_export_event to authenticated;

-- ---------------------------------------------------------------------------
-- New user bootstrap: auto-create a profile row (role='client' by default)
-- when a new auth.users row appears. Admin promotion happens afterward via
-- set_user_role(), invoked by an existing admin or the bootstrap script.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'client');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
