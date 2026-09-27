-- ============================================================================
-- Shree Shivansh Stores — BETA V1
-- Migration 0001: Core schema (tables, enums, indexes)
-- Terminology preserved from the source workbook wherever practical.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ROLES & PROFILES
-- ---------------------------------------------------------------------------
create type app_role as enum ('client', 'admin');

-- One row per authenticated user (mirrors auth.users, holds app-specific data)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone         text,
  role          app_role not null default 'client',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table profiles is 'App-level user profile + role. role is the single source of truth for authorization; never trust a client-supplied role.';

-- ---------------------------------------------------------------------------
-- PRODUCTS  (from PA sheet: product master + product-analysis)
-- ---------------------------------------------------------------------------
create table products (
  id                uuid primary key default gen_random_uuid(),
  product_name      text not null,
  category          text,
  mrp               numeric(12,2) not null default 0 check (mrp >= 0),
  cost_per_unit     numeric(12,2) not null default 0 check (cost_per_unit >= 0),
  offline_sp        numeric(12,2) not null default 0 check (offline_sp >= 0), -- "Offline Selling Price" from PA
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table products is 'Product master, derived from PA sheet columns A-E. Quantity sold / revenue / profit are DERIVED (view), never stored duplicated fields, to stay authoritative.';

create unique index products_name_unique_idx on products (lower(product_name));
create index products_category_idx on products (category);
create index products_active_idx on products (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- CUSTOMERS  (customer register)
-- ---------------------------------------------------------------------------
create table customers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text,                -- used for WhatsApp deep link
  whatsapp      text,                -- optional distinct WhatsApp number
  address       text,
  reference     text,                -- corresponds loosely to Sales Register "CUSTOMER NO." free-text tag
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint customers_phone_format check (phone is null or phone ~ '^[0-9+\-\s()]{6,20}$'),
  constraint customers_whatsapp_format check (whatsapp is null or whatsapp ~ '^[0-9+\-\s()]{6,20}$')
);

create index customers_phone_idx on customers (phone);
create index customers_name_idx on customers (lower(full_name));

-- ---------------------------------------------------------------------------
-- SALES REGISTER  (primary client-facing operational register)
-- ---------------------------------------------------------------------------
create type payment_mode as enum ('CASH', 'UPI', 'CREDIT');
create type shift_type as enum ('MORNING', 'EVENING');

create table sales (
  id              uuid primary key default gen_random_uuid(),
  sale_date       date not null default current_date,
  customer_id     uuid references customers(id),
  customer_ref    text,                 -- free-text fallback (workbook "CUSTOMER NO." tag, e.g. "Grocery")
  payment_mode    payment_mode not null default 'CASH',
  shift           shift_type,
  bill_id         uuid,                 -- set after bill generation (FK added after bills table exists)
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  -- amount/profit are NOT stored here at header level; they are derived from sale_items (see view)
  is_voided       boolean not null default false,
  void_reason     text,
  voided_by       uuid references profiles(id),
  voided_at       timestamptz
);

comment on table sales is 'Sale header. One row per Register Sale transaction. Financial totals are computed from sale_items, never trusted from client input.';

create index sales_date_idx on sales (sale_date desc);
create index sales_customer_idx on sales (customer_id);
create index sales_created_by_idx on sales (created_by);
create index sales_bill_idx on sales (bill_id);

create table sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references sales(id) on delete cascade,
  product_id      uuid not null references products(id),
  item_name_snap  text not null,         -- snapshot of product name at time of sale
  qty             numeric(12,3) not null check (qty > 0),
  sold_inr        numeric(12,2) not null check (sold_inr >= 0),   -- "sold(INR)" = actual selling rate charged
  mrp_snap        numeric(12,2) not null default 0,
  cost_snap       numeric(12,2) not null default 0,               -- cost_per_unit snapshot, admin-only exposure
  amount          numeric(14,2) generated always as (qty * sold_inr) stored, -- Amount = Qty × sold(INR)
  created_at      timestamptz not null default now()
);

comment on table sale_items is 'Line items. amount is a generated column (server-authoritative), matching workbook rule Amount = Qty × sold(INR).';

create index sale_items_sale_idx on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);

-- Credit ledger (fuller ledger per user's decision: running balance + partial payments)
create table credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id),
  sale_id       uuid references sales(id),          -- null for a standalone payment entry
  entry_type    text not null check (entry_type in ('CHARGE','PAYMENT','ADJUSTMENT')),
  amount        numeric(12,2) not null,               -- positive for CHARGE/ADJUSTMENT(+), negative allowed for ADJUSTMENT(-)
  note          text,
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);

comment on table credit_ledger is 'Per-customer running credit balance. CHARGE increases what they owe, PAYMENT decreases it. Balance = sum(amount) per customer, always recomputed, never stored as a mutable field.';

create index credit_ledger_customer_idx on credit_ledger (customer_id);
create index credit_ledger_sale_idx on credit_ledger (sale_id);

-- ---------------------------------------------------------------------------
-- BILLS
-- ---------------------------------------------------------------------------
create table bill_counters (
  counter_key   text primary key,        -- e.g. to_char(sale_date,'YYYYMM') for monthly reset, or 'GLOBAL'
  next_seq      bigint not null default 1
);

comment on table bill_counters is 'Backend-only sequence source for bill numbers. Never generate bill numbers on the client.';

create table bills (
  id              uuid primary key default gen_random_uuid(),
  bill_number     text not null unique,     -- e.g. SSS-202607-000123 (prefix configurable via app_settings)
  sale_id         uuid not null references sales(id),
  customer_id     uuid references customers(id),
  bill_date       date not null default current_date,
  subtotal        numeric(14,2) not null default 0,
  total_amount    numeric(14,2) not null default 0,
  saved_amount    numeric(14,2) not null default 0,   -- MRP total - our-rate total ("You Saved")
  payment_mode    payment_mode not null,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  is_voided       boolean not null default false
);

create index bills_number_idx on bills (bill_number);
create index bills_sale_idx on bills (sale_id);
create index bills_date_idx on bills (bill_date desc);
create index bills_customer_idx on bills (customer_id);

alter table sales add constraint sales_bill_fk foreign key (bill_id) references bills(id);

-- ---------------------------------------------------------------------------
-- PURCHASE REGISTER  (admin-only)
-- ---------------------------------------------------------------------------
create type paid_credit as enum ('PAID', 'CREDIT');

create table purchases (
  id              uuid primary key default gen_random_uuid(),
  purchase_date   date not null default current_date,
  supplier        text not null,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  is_voided       boolean not null default false
);

create table purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references purchases(id) on delete cascade,
  product_id      uuid not null references products(id),
  item_name_snap  text not null,
  qty             numeric(12,3) not null check (qty > 0),
  amount          numeric(14,2) not null check (amount >= 0),
  cost_per_unit   numeric(12,4) generated always as (
                     case when qty = 0 then 0 else amount / qty end
                   ) stored,   -- Cost per unit = Amount / Qty
  paid_credit     paid_credit not null default 'PAID',
  created_at      timestamptz not null default now()
);

create index purchases_date_idx on purchases (purchase_date desc);
create index purchases_supplier_idx on purchases (supplier);
create index purchase_items_purchase_idx on purchase_items (purchase_id);
create index purchase_items_product_idx on purchase_items (product_id);

-- ---------------------------------------------------------------------------
-- STOCK MOVEMENTS  (admin-only; Stock Register is derived from this ledger)
-- ---------------------------------------------------------------------------
create type stock_movement_type as enum ('OPENING', 'PURCHASE', 'SALE', 'ADJUSTMENT', 'PHYSICAL_COUNT');

create table stock_movements (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  movement_type   stock_movement_type not null,
  qty_delta       numeric(12,3) not null,   -- positive = stock in, negative = stock out
  reference_table text,                      -- 'sales' | 'purchases' | null
  reference_id    uuid,
  note            text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

comment on table stock_movements is 'Append-only stock ledger. Stock Register Closing = sum(qty_delta) per product, always recomputed from this table, never trusted as a stored mutable value.';

create index stock_movements_product_idx on stock_movements (product_id);
create index stock_movements_ref_idx on stock_movements (reference_table, reference_id);

create table physical_stock_counts (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  counted_qty     numeric(12,3) not null,
  count_date      date not null default current_date,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  note            text
);

create index physical_counts_product_idx on physical_stock_counts (product_id);

-- ---------------------------------------------------------------------------
-- EXPENSE REGISTER (admin-only)
-- ---------------------------------------------------------------------------
create table expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date,
  expense_type    text not null,
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  mode            text,
  notes           text,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  is_voided       boolean not null default false
);

create index expenses_date_idx on expenses (expense_date desc);
create index expenses_type_idx on expenses (expense_type);

-- ---------------------------------------------------------------------------
-- DAILY ACCOUNTS (admin-only)
-- ---------------------------------------------------------------------------
create table daily_accounts (
  id                  uuid primary key default gen_random_uuid(),
  account_date        date not null unique,
  opening_cash        numeric(12,2) not null default 0,
  cash_in_morning     numeric(12,2) not null default 0,
  cash_in_evening     numeric(12,2) not null default 0,
  upi_in              numeric(12,2) not null default 0,
  cash_out            numeric(12,2) not null default 0,
  closing_cash        numeric(12,2) generated always as (
                         opening_cash + cash_in_morning + cash_in_evening + upi_in - cash_out
                       ) stored,
  day_total           numeric(12,2) generated always as (
                         opening_cash + cash_in_morning + cash_in_evening
                       ) stored,  -- matches workbook: =Opening+Morning+Evening
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index daily_accounts_date_idx on daily_accounts (account_date desc);

-- ---------------------------------------------------------------------------
-- APP SETTINGS (admin-only, non-secret configuration)
-- ---------------------------------------------------------------------------
create table app_settings (
  key           text primary key,
  value         jsonb not null,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now()
);

comment on table app_settings is 'Store profile, bill numbering config, WhatsApp template, feature flags. NEVER store secrets/service keys here.';

-- ---------------------------------------------------------------------------
-- AUDIT LOGS (append-only)
-- ---------------------------------------------------------------------------
create table audit_logs (
  id              bigint generated always as identity primary key,
  event_time      timestamptz not null default now(),
  actor_id        uuid references profiles(id),
  actor_role      app_role,
  action          text not null,        -- e.g. 'sale.create', 'login', 'export.sales', 'stock.adjust'
  entity_table    text,
  entity_id       text,
  before_value    jsonb,
  after_value     jsonb,
  ip_address      text,
  user_agent      text,
  success         boolean not null default true,
  error_message   text
);

comment on table audit_logs is 'Append-only. No update/delete grants for any role, including admin, via RLS below. Populated primarily by SECURITY DEFINER functions/triggers so it cannot be bypassed from the frontend.';

create index audit_logs_time_idx on audit_logs (event_time desc);
create index audit_logs_actor_idx on audit_logs (actor_id);
create index audit_logs_action_idx on audit_logs (action);
create index audit_logs_entity_idx on audit_logs (entity_table, entity_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();
create trigger trg_products_updated before update on products for each row execute function set_updated_at();
create trigger trg_customers_updated before update on customers for each row execute function set_updated_at();
create trigger trg_daily_accounts_updated before update on daily_accounts for each row execute function set_updated_at();
