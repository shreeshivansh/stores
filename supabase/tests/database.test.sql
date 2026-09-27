-- ============================================================================
-- Shree Shivansh Stores — pgTAP database test suite
--
-- Covers: sale registration (register_sale), bill generation (generate_bill),
-- stock calculation (stock_movements ledger), role separation / RLS access,
-- unauthorized admin-data access, and audit logging.
--
-- Run with the Supabase CLI (applies all migrations first, then this file):
--   supabase test db
--
-- Or directly against a local Postgres with pgTAP installed:
--   psql "$DATABASE_URL" -f supabase/tests/database.test.sql
--
-- Requires the pgTAP extension. The Supabase CLI's test runner installs it
-- automatically; for a bare Postgres instance run:
--   create extension if not exists pgtap;
-- ============================================================================

begin;
select plan(39);

create extension if not exists pgtap;

-- ---------------------------------------------------------------------------
-- Fixtures: two auth users (one client, one admin) + a product + a customer.
-- auth.users is Supabase-managed; inserting directly is the standard pgTAP
-- pattern for exercising RLS locally without going through GoTrue.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'client@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other-client@test.local');

-- handle_new_user() trigger auto-creates the profile rows as role='client'.
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

insert into products (id, product_name, category, mrp, cost_per_unit, offline_sp)
values ('a0000000-0000-0000-0000-000000000001', 'Test Tata Salt', 'Grocery', 30, 24, 27);

insert into customers (id, full_name, phone, created_by)
values ('c0000000-0000-0000-0000-000000000001', 'Test Customer', '9876543210',
        '11111111-1111-1111-1111-111111111111');

-- register_sale() enforces a live stock guard (see 0004_functions.sql), so the
-- product needs opening stock before any sale can be registered against it —
-- otherwise even a 1-unit sale correctly fails with "Insufficient stock".
insert into stock_movements (product_id, movement_type, qty_delta, note, created_by)
values ('a0000000-0000-0000-0000-000000000001', 'OPENING', 10,
        'pgTAP fixture: opening balance', '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------
-- Helper to switch the pgTAP session's auth.uid() the way Supabase's RLS
-- helpers expect (auth.uid() reads request.jwt.claim.sub via local setting).
-- ---------------------------------------------------------------------------
create or replace function test_set_auth(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$ language plpgsql;

-- ===========================================================================
-- 1) SALE REGISTRATION (register_sale)
-- ===========================================================================
select test_set_auth('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select register_sale(
       current_date, 'c0000000-0000-0000-0000-000000000001'::uuid, null,
       'CASH'::payment_mode, 'MORNING'::shift_type,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 2, 27)::sale_item_input],
       false) $$,
  'register_sale succeeds for an authenticated client with valid items'
);

select is(
  (select count(*)::int from sales where created_by = '11111111-1111-1111-1111-111111111111'),
  1,
  'exactly one sale header row was created'
);

select is(
  (select amount from sale_items si join sales s on s.id = si.sale_id
     where s.created_by = '11111111-1111-1111-1111-111111111111' limit 1),
  54.00,
  'sale_items.amount is server-computed as qty * sold_inr (2 * 27 = 54)'
);

select throws_ok(
  $$ select register_sale(
       current_date, null, null, 'CASH'::payment_mode, null,
       array[]::sale_item_input[], false) $$,
  'Sale must contain at least one item',
  'register_sale rejects an empty item array'
);

select throws_ok(
  $$ select register_sale(
       current_date, null, null, 'CASH'::payment_mode, null,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, -1, 27)::sale_item_input], false) $$,
  'Invalid quantity for product a0000000-0000-0000-0000-000000000001',
  'register_sale rejects a non-positive quantity'
);

select throws_ok(
  $$ select register_sale(
       current_date, null, null, 'CASH'::payment_mode, null,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 1, -5)::sale_item_input], false) $$,
  'Invalid selling price for product a0000000-0000-0000-0000-000000000001',
  'register_sale rejects a negative selling price'
);

-- Credit sale requires a customer
select throws_ok(
  $$ select register_sale(
       current_date, null, null, 'CREDIT'::payment_mode, null,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 1, 27)::sale_item_input], false) $$,
  'Customer is required for a credit sale',
  'register_sale rejects a CREDIT sale with no customer_id'
);

-- Credit sale with a customer creates a credit_ledger CHARGE row
select lives_ok(
  $$ select register_sale(
       current_date, 'c0000000-0000-0000-0000-000000000001'::uuid, null,
       'CREDIT'::payment_mode, null,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 1, 27)::sale_item_input], false) $$,
  'register_sale succeeds for a CREDIT sale with a customer'
);

select is(
  (select entry_type from credit_ledger where customer_id = 'c0000000-0000-0000-0000-000000000001'
     order by created_at desc limit 1),
  'CHARGE',
  'a CREDIT sale writes a CHARGE row to credit_ledger'
);

-- ===========================================================================
-- 2) STOCK CALCULATION (stock_movements ledger)
-- ===========================================================================
-- stock_movements is admin-only via RLS (stock_movements_admin_only), so
-- reading it must happen as the admin, not the client who just registered
-- the sale — querying it while still authenticated as the client would be
-- silently row-filtered to nothing rather than reflecting an actual bug.
select test_set_auth('22222222-2222-2222-2222-222222222222');

select is(
  (select coalesce(sum(qty_delta), 0) from stock_movements
     where product_id = 'a0000000-0000-0000-0000-000000000001'
       and movement_type = 'SALE'),
  -3::numeric,
  'stock_movements records -qty for every SALE (2 + 1 units sold so far = -3)'
);

select lives_ok(
  $$ select record_purchase(
       current_date, 'Test Supplier',
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 100, 2200)::purchase_item_input],
       'PAID'::paid_credit) $$,
  'record_purchase succeeds for an admin'
);

select is(
  (select coalesce(sum(qty_delta), 0) from stock_movements
     where product_id = 'a0000000-0000-0000-0000-000000000001'),
  107::numeric,
  'closing stock is the running sum of all movements (10 opening + 100 purchased - 3 sold = 107)'
);

-- Insufficient stock is blocked unless explicitly overridden
select test_set_auth('11111111-1111-1111-1111-111111111111');
select throws_like(
  $$ select register_sale(
       current_date, null, null, 'CASH'::payment_mode, null,
       array[row('a0000000-0000-0000-0000-000000000001'::uuid, 99999, 27)::sale_item_input], false) $$,
  'Insufficient stock%',
  'register_sale blocks a sale that would take stock negative'
);

-- ===========================================================================
-- 3) BILL GENERATION (generate_bill)
-- ===========================================================================
select test_set_auth('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select generate_bill(
       (select id from sales where created_by = '11111111-1111-1111-1111-111111111111'
          and payment_mode = 'CASH' order by created_at limit 1)) $$,
  'generate_bill succeeds for the sale''s own creator'
);

select is(
  (select count(*)::int from bills where created_by = '11111111-1111-1111-1111-111111111111'),
  1,
  'exactly one bill row was created'
);

select matches(
  (select bill_number from bills where created_by = '11111111-1111-1111-1111-111111111111' limit 1),
  '^SSS-\d{6}-\d{6}$',
  'bill_number follows the PREFIX-YYYYMM-NNNNNN format'
);

select is(
  (select generate_bill(
     (select id from sales where created_by = '11111111-1111-1111-1111-111111111111'
        and payment_mode = 'CASH' order by created_at limit 1))),
  (select id from bills where created_by = '11111111-1111-1111-1111-111111111111' limit 1),
  'generate_bill is idempotent — calling it again returns the same bill_id'
);

-- Capture the sale id while still authenticated as its owner (admin also
-- works, but reusing the current identity avoids an extra switch). Doing
-- this lookup AFTER switching to other-client would itself be RLS-filtered
-- to created_by = auth.uid(), silently resolving to NULL and making
-- generate_bill(NULL) fail with "Sale not found" for an unrelated reason —
-- masking the authorization check this test is actually meant to exercise.
select id as first_cash_sale_id from sales
  where created_by = '11111111-1111-1111-1111-111111111111' and payment_mode = 'CASH'
  order by created_at limit 1 \gset

select test_set_auth('33333333-3333-3333-3333-333333333333');
select throws_ok(
  format($fmt$ select generate_bill('%s'::uuid) $fmt$, :'first_cash_sale_id'),
  'Not authorized for this sale',
  'generate_bill refuses a user who did not create the sale'
);

-- ===========================================================================
-- 4) ROLE SEPARATION / RLS ACCESS
-- ===========================================================================

-- 4a. Clients cannot see other clients' sales via the sales register view.
select test_set_auth('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from v_sales_register
     where sale_id in (select id from sales where created_by = '11111111-1111-1111-1111-111111111111')),
  0,
  'a client cannot see another client''s rows in v_sales_register'
);

-- 4b. A client cannot select from purchases (admin-only table) at all.
select is(
  (select count(*)::int from purchases),
  0,
  'a client-role user gets zero rows from purchases (admin-only RLS)'
);

-- 4c. A client cannot select from expenses.
select is(
  (select count(*)::int from expenses),
  0,
  'a client-role user gets zero rows from expenses (admin-only RLS)'
);

-- 4d. A client cannot select from stock_movements.
select is(
  (select count(*)::int from stock_movements),
  0,
  'a client-role user gets zero rows from stock_movements (admin-only RLS)'
);

-- 4e. cost_per_unit is never exposed to a client even on the one row they
-- are allowed to see (column-level grant, defense in depth over the RLS row filter).
-- Note: Postgres reports a column-privilege violation with the same generic
-- "permission denied for table X" wording as a table-level violation (this is
-- long-standing Postgres behavior, not something this schema controls — see
-- https://www.postgresql.org/message-id/185919.1729096902%40sss.pgh.pa.us),
-- so this only asserts that access is denied, not the exact wording.
select throws_ok(
  $$ select cost_per_unit from products where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'a client-role user is denied SELECT on products.cost_per_unit at the column-grant level'
);

-- 4f. A client CAN see the public product projection.
select is(
  (select selling_price from v_products_public where id = 'a0000000-0000-0000-0000-000000000001'),
  27.00,
  'a client can read the selling price via v_products_public (offline_sp exposed as selling_price)'
);

-- 4g. Admin-gated aggregate views are unreachable directly, even for an admin
-- (they must go through the RPC, per the defense-in-depth comment in 0003).
select test_set_auth('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from v_product_analysis limit 1 $$,
  'permission denied for view v_product_analysis',
  'v_product_analysis is revoked from authenticated entirely, including admins — RPC-only access'
);

select lives_ok(
  $$ select * from get_product_analysis() limit 1 $$,
  'get_product_analysis() RPC succeeds for an admin'
);

-- 4h. An admin has full access to admin-only tables.
select isnt(
  (select count(*)::int from purchases),
  0,
  'an admin-role user CAN see rows in purchases'
);

-- 4i. A client cannot self-promote their own role.
select test_set_auth('11111111-1111-1111-1111-111111111111');
-- Same Postgres wording caveat as the cost_per_unit check above: a
-- column-privilege violation is reported as a generic table-level message.
select throws_ok(
  $$ update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  null,
  'a client cannot UPDATE their own profiles.role directly (column revoked)'
);

-- ===========================================================================
-- 5) UNAUTHORIZED ADMIN-DATA ACCESS (RPC-level guards)
-- ===========================================================================
select test_set_auth('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ select get_product_analysis() $$,
  'Admin access required',
  'get_product_analysis() rejects a client-role caller'
);

select throws_ok(
  $$ select get_stock_register() $$,
  'Admin access required',
  'get_stock_register() rejects a client-role caller'
);

select throws_ok(
  $$ select get_monthly_summary() $$,
  'Admin access required',
  'get_monthly_summary() rejects a client-role caller'
);

select throws_ok(
  $$ select record_purchase(current_date, 'X', array[]::purchase_item_input[], 'PAID'::paid_credit) $$,
  'Admin access required',
  'record_purchase() rejects a client-role caller'
);

select throws_ok(
  $$ select void_sale((select id from sales limit 1), 'test') $$,
  'Admin access required',
  'void_sale() rejects a client-role caller'
);

select throws_ok(
  $$ select set_user_role('11111111-1111-1111-1111-111111111111'::uuid, 'admin'::app_role) $$,
  'Admin access required',
  'set_user_role() rejects a client-role caller (cannot self-promote via RPC either)'
);

-- ===========================================================================
-- 6) AUDIT LOGGING
-- ===========================================================================

-- 6a. register_sale() writes a sale.create audit row for the acting user.
-- (audit_logs is admin-only to SELECT, so we must switch to the admin
-- context to check it — this is the direct assertion, not a client-side one.)
select test_set_auth('22222222-2222-2222-2222-222222222222');
select isnt(
  (select count(*)::int from audit_logs
     where action = 'sale.create' and actor_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'audit_logs contains sale.create rows attributed to the client who registered the sale (visible to admin)'
);

select isnt(
  (select count(*)::int from audit_logs where action = 'bill.generate'),
  0,
  'audit_logs contains a bill.generate row from generate_bill()'
);

-- 6b. A client cannot read audit_logs at all (admin-only SELECT policy).
select test_set_auth('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from audit_logs),
  0,
  'a client-role user gets zero rows from audit_logs (admin-only RLS)'
);

-- 6c. audit_logs cannot be written directly by any client-callable path.
-- There is no INSERT grant to `authenticated` at all (see 0003), so a direct
-- INSERT attempt is denied at the grant layer before RLS is even evaluated —
-- a stronger guarantee than an RLS-only denial would give, but with the
-- generic grant-denied wording rather than the RLS-specific message.
select throws_ok(
  $$ insert into audit_logs (actor_id, action) values (
       '11111111-1111-1111-1111-111111111111', 'fake.event') $$,
  '42501',
  null,
  'a direct INSERT into audit_logs is blocked — writes only via log_audit_event()'
);

-- 6d. audit_logs is append-only — no UPDATE/DELETE grant for any role, even admin.
select test_set_auth('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ delete from audit_logs where action = 'sale.create' $$,
  '42501',
  null,
  'audit_logs rows cannot be deleted, even by an admin (no DELETE grant exists)'
);

select * from finish();
rollback;
