-- ============================================================================
-- Migration 0003: Row Level Security
-- Every table below has RLS enabled and FORCED. Policies are the ONLY way
-- data flows to a client — there is no "trust the frontend" path here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, stable) — avoid recursive RLS issues
-- ---------------------------------------------------------------------------
create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false);
$$;

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select_own on profiles for select
  using (id = auth.uid() or is_admin());

create policy profiles_update_own_limited on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())); -- cannot self-promote role

create policy profiles_admin_all on profiles for all
  using (is_admin()) with check (is_admin());

-- Role changes must go through an admin-only function (not direct UPDATE) so they're audited.
revoke update (role) on profiles from authenticated;

-- ---------------------------------------------------------------------------
-- PRODUCTS — clients may read a LIMITED public projection only, via view.
-- Base table: full row (incl. cost_per_unit) is admin-only.
-- ---------------------------------------------------------------------------
alter table products enable row level security;
alter table products force row level security;

create policy products_admin_all on products for all
  using (is_admin()) with check (is_admin());

-- Clients get no direct SELECT on the base table (cost/MRP margin data lives here).
-- Defense in depth: (1) RLS policy allows clients to see only active rows,
-- AND (2) column-level GRANTs restrict which columns are visible even for
-- those rows. Both must hold for a client query to return only safe data.
create policy products_client_select_active on products for select
  to authenticated
  using (not is_admin() and is_active = true);

revoke select on products from authenticated;
grant select (id, product_name, category, mrp, offline_sp, is_active) on products to authenticated;
-- offline_sp (selling price) and mrp are intentionally visible — a client needs
-- them to register a sale and to know the printed MRP for a bill.
-- cost_per_unit (the store's purchase cost / margin secret) remains ungranted
-- to `authenticated` — this is the one column that must never reach a client.

-- Client-facing product search view built ONLY from the granted columns above,
-- so it structurally cannot leak cost_per_unit even if the view definition
-- is later edited carelessly (the grant, not the view SQL, is the backstop).
create view v_products_public as
select id, product_name, category, mrp, offline_sp as selling_price, is_active
from products
where is_active;

alter view v_products_public set (security_invoker = true);
grant select on v_products_public to authenticated;

-- ---------------------------------------------------------------------------
-- CUSTOMERS — client can read/write customers they created or are attached
-- to their own sales; admin sees all.
-- ---------------------------------------------------------------------------
alter table customers enable row level security;
alter table customers force row level security;

create policy customers_admin_all on customers for all
  using (is_admin()) with check (is_admin());

create policy customers_client_select on customers for select
  to authenticated
  using (
    not is_admin() and (
      created_by = auth.uid()
      or exists (select 1 from sales s where s.customer_id = customers.id and s.created_by = auth.uid())
    )
  );

create policy customers_client_insert on customers for insert
  to authenticated
  with check (not is_admin() and created_by = auth.uid() and is_active_user());

create policy customers_client_update_own on customers for update
  to authenticated
  using (not is_admin() and created_by = auth.uid())
  with check (not is_admin() and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- SALES / SALE_ITEMS — client: own rows only. admin: all rows.
-- INSERT must go through register_sale() function (below), not raw INSERT,
-- so stock movements + audit log always happen atomically. We still allow
-- SELECT policies here for read access and completeness.
-- ---------------------------------------------------------------------------
alter table sales enable row level security;
alter table sales force row level security;

create policy sales_admin_all on sales for all
  using (is_admin()) with check (is_admin());

create policy sales_client_select_own on sales for select
  to authenticated
  using (not is_admin() and created_by = auth.uid());

-- No direct client INSERT/UPDATE policy on sales — must use register_sale() RPC.
-- (Function runs as SECURITY DEFINER and performs the insert internally.)

alter table sale_items enable row level security;
alter table sale_items force row level security;

create policy sale_items_admin_all on sale_items for all
  using (is_admin()) with check (is_admin());

create policy sale_items_client_select_own on sale_items for select
  to authenticated
  using (
    not is_admin()
    and exists (select 1 from sales s where s.id = sale_items.sale_id and s.created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- CREDIT LEDGER — client sees entries tied to their own sales/customers created by them; admin sees all
-- ---------------------------------------------------------------------------
alter table credit_ledger enable row level security;
alter table credit_ledger force row level security;

create policy credit_ledger_admin_all on credit_ledger for all
  using (is_admin()) with check (is_admin());

create policy credit_ledger_client_select on credit_ledger for select
  to authenticated
  using (
    not is_admin() and exists (
      select 1 from customers c where c.id = credit_ledger.customer_id and c.created_by = auth.uid()
    )
  );

-- Client inserts credit entries only via register_sale()/record_credit_payment() RPCs.

-- ---------------------------------------------------------------------------
-- BILLS — client sees bills for their own sales; admin sees all.
-- ---------------------------------------------------------------------------
alter table bills enable row level security;
alter table bills force row level security;

create policy bills_admin_all on bills for all
  using (is_admin()) with check (is_admin());

create policy bills_client_select_own on bills for select
  to authenticated
  using (not is_admin() and created_by = auth.uid());

-- No direct INSERT policy — bills are created only via generate_bill() RPC.

create table if not exists bill_counters_dummy (id int); drop table if exists bill_counters_dummy; -- (no-op safeguard, ignore)

alter table bill_counters enable row level security;
alter table bill_counters force row level security;
-- No policies granted at all: bill_counters is touched only inside SECURITY DEFINER functions.

-- ---------------------------------------------------------------------------
-- PURCHASE REGISTER — admin only, full stop.
-- ---------------------------------------------------------------------------
alter table purchases enable row level security;
alter table purchases force row level security;
create policy purchases_admin_only on purchases for all using (is_admin()) with check (is_admin());

alter table purchase_items enable row level security;
alter table purchase_items force row level security;
create policy purchase_items_admin_only on purchase_items for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- STOCK MOVEMENTS / PHYSICAL COUNTS — admin only (client never sees stock)
-- ---------------------------------------------------------------------------
alter table stock_movements enable row level security;
alter table stock_movements force row level security;
create policy stock_movements_admin_only on stock_movements for all using (is_admin()) with check (is_admin());

alter table physical_stock_counts enable row level security;
alter table physical_stock_counts force row level security;
create policy physical_counts_admin_only on physical_stock_counts for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- EXPENSE REGISTER — admin only
-- ---------------------------------------------------------------------------
alter table expenses enable row level security;
alter table expenses force row level security;
create policy expenses_admin_only on expenses for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- DAILY ACCOUNTS — admin only
-- ---------------------------------------------------------------------------
alter table daily_accounts enable row level security;
alter table daily_accounts force row level security;
create policy daily_accounts_admin_only on daily_accounts for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- APP SETTINGS — admin read/write; clients can read a small public subset
-- (store name, WhatsApp template, bill prefix display) via a view.
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table app_settings force row level security;
create policy app_settings_admin_all on app_settings for all using (is_admin()) with check (is_admin());

create view v_public_settings as
select key, value from app_settings
where key in ('store_profile', 'whatsapp_template', 'feature_flags', 'currency');

alter view v_public_settings set (security_invoker = true);
create policy app_settings_client_read_public on app_settings for select
  to authenticated
  using (not is_admin() and key in ('store_profile','whatsapp_template','feature_flags','currency'));

-- ---------------------------------------------------------------------------
-- AUDIT LOGS — admin read-only. No update/delete for anyone. Inserts only
-- via SECURITY DEFINER functions (log_audit_event), never direct client insert.
-- ---------------------------------------------------------------------------
alter table audit_logs enable row level security;
alter table audit_logs force row level security;

create policy audit_logs_admin_select on audit_logs for select
  using (is_admin());
-- Deliberately: no insert/update/delete policy for any role. Writes happen
-- exclusively through the log_audit_event() SECURITY DEFINER function which
-- bypasses RLS internally (owned by a privileged role), so the append-only
-- guarantee cannot be defeated from client code, including admin UI code.

-- ---------------------------------------------------------------------------
-- Views: grant select to authenticated (RLS on underlying tables still applies
-- because all views use security_invoker = true, set above)
-- ---------------------------------------------------------------------------
-- IMPORTANT: v_product_analysis and v_stock_register expose cost/MRP/margin
-- and stock-position data that must be strictly admin-only. Column-level
-- grants on the base `products` table are not sufficient protection for a
-- view that aggregates across rows/joins, so these two views are revoked
-- from `authenticated` entirely and exposed only through admin-checked RPCs
-- (see 0004_functions.sql: get_product_analysis(), get_stock_register()).
revoke all on v_product_analysis from authenticated, anon;
revoke all on v_stock_register from authenticated, anon;

grant select on v_sales_register to authenticated;   -- protected by sales/sale_items RLS (own rows for clients)
grant select on v_customer_credit_balance to authenticated; -- protected by credit_ledger RLS
grant select on v_daily_accounts_extended to authenticated; -- daily_accounts RLS is admin-only, so clients get 0 rows
grant select on v_monthly_summary to authenticated;          -- built from sales/purchases/expenses; see note below
grant select on v_public_settings to authenticated;

-- v_monthly_summary aggregates purchases/expenses (admin-only tables) and
-- ALL sales (not just the client's own), so it must also be admin-gated.
-- Revoke direct access; expose via get_monthly_summary() RPC instead.
revoke all on v_monthly_summary from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Base-table grants for `authenticated`.
--
-- IMPORTANT: RLS policies alone grant nothing. A policy only filters ROWS
-- once a role already has table/column-level privilege to touch the table at
-- all — with no GRANT, every query gets "permission denied for table ..."
-- regardless of how permissive the policy is. Historically Supabase projects
-- granted SELECT/INSERT/UPDATE/DELETE on every new public table to `anon` and
-- `authenticated` by default, which is what let this migration's policies
-- above (profiles_select_own, sales_client_select_own, bills_client_select_own,
-- customers_client_insert, etc.) work without an explicit GRANT alongside
-- them. Supabase has since made that default opt-in per project (new
-- projects may start with NO automatic grants), so relying on the platform
-- default is no longer safe — grants are made explicit here instead, scoped
-- to exactly what each policy and the frontend's actual query shape need.
-- See src/services/salesService.ts and src/services/customerService.ts for
-- the base-table reads/writes (bills, sale_items, customers) this backs.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, update (full_name, phone) on profiles to authenticated;
-- update(role) was already revoked just above; role changes are RPC-only.

grant select, insert on customers to authenticated;
-- No UPDATE grant beyond what's already revoked implicitly by omission:
-- customers_client_update_own policy exists for future use, but the app's
-- current UI never updates a customer row, so update is intentionally
-- withheld until that path exists (least privilege).
grant update (full_name, phone, whatsapp, address, reference) on customers to authenticated;

grant select on sales to authenticated;
-- No direct INSERT/UPDATE — register_sale()/void_sale() RPCs only (both
-- SECURITY DEFINER, so they don't need this grant to write).

grant select on sale_items to authenticated;
-- No direct INSERT/UPDATE — written only inside register_sale().

grant select on bills to authenticated;
-- No direct INSERT — written only inside generate_bill().

grant select, insert on credit_ledger to authenticated;
-- Matches record_credit_payment()'s SECURITY DEFINER insert plus the
-- credit_ledger_client_select_own policy defined above.

-- Admin-only tables: the RLS policies above (purchases_admin_only,
-- expenses_admin_only, audit_logs_admin_select, app_settings_admin_all) key
-- entirely off is_admin(), but an admin's session is still the `authenticated`
-- Postgres role — RLS then correctly narrows these to zero rows for a
-- non-admin caller, but the grant must exist for anyone to reach the RLS
-- check at all.
grant select, insert, update on purchases to authenticated;
grant select, insert on purchase_items to authenticated;
grant select, insert, update on expenses to authenticated;
grant select on audit_logs to authenticated; -- writes are RPC-only (log_audit_event), see 0004
grant select, insert, update on app_settings to authenticated; -- app_settings_client_read_public further narrows non-admin SELECT to the public-flagged rows
grant select, insert on stock_movements to authenticated; -- record_purchase()/register_sale() write via SECURITY DEFINER; admin UI reads directly
grant select, insert on physical_stock_counts to authenticated;
grant select on daily_accounts to authenticated; -- admin-only via RLS; no direct client write path in the current UI

comment on schema public is 'Base-table grants for authenticated are explicit in 0003_rls_policies.sql — do not rely on a platform default that may not apply to this project.';
