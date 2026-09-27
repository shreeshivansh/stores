-- ============================================================================
-- Migration 0002: Derived / computed views
-- These replace spreadsheet formulas with recomputed-from-source-data logic.
-- Nothing here is a stored duplicate that could drift from the transactions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Sales Register "row" view — mirrors workbook columns, admin + client use
-- (client access is still gated by RLS on the underlying tables; this view
--  inherits that via security_invoker so it never becomes a bypass)
-- ---------------------------------------------------------------------------
create view v_sales_register as
select
  s.id                as sale_id,
  s.sale_date,
  coalesce(c.full_name, s.customer_ref) as customer_display,
  s.customer_id,
  si.id               as sale_item_id,
  si.item_name_snap   as item,
  si.qty,
  si.sold_inr,
  si.amount,
  s.payment_mode,
  s.shift,
  s.created_by,
  s.created_at,
  s.bill_id,
  s.is_voided
from sales s
join sale_items si on si.sale_id = s.id
left join customers c on c.id = s.customer_id;

alter view v_sales_register set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- PA (Product Analysis) — admin-only via RLS on products/sale_items
-- Replicates: Revenue = SP*Qty, Total Cost = Cost*Qty, Gross Profit, Profit %,
-- classification labels NO PROFIT / 100% or More / SERIOUS LOSS-style text.
-- ---------------------------------------------------------------------------
create view v_product_analysis as
with sold as (
  select
    si.product_id,
    sum(si.qty)                as quantity_sold,
    sum(si.amount)              as revenue
  from sale_items si
  join sales s on s.id = si.sale_id and not s.is_voided
  group by si.product_id
)
select
  p.id                    as product_id,
  p.product_name,
  p.category,
  p.mrp,
  p.cost_per_unit,
  p.offline_sp,
  coalesce(sd.quantity_sold, 0)                          as quantity_sold,
  coalesce(sd.revenue, 0)                                as revenue,
  coalesce(sd.quantity_sold, 0) * p.cost_per_unit         as total_cost,
  coalesce(sd.revenue, 0) - (coalesce(sd.quantity_sold, 0) * p.cost_per_unit) as gross_profit,
  case when coalesce(sd.revenue,0) = 0 then 0
       else (coalesce(sd.revenue,0) - (coalesce(sd.quantity_sold,0) * p.cost_per_unit)) / coalesce(sd.revenue,0)
  end as profit_pct,
  case
    when p.offline_sp <= p.cost_per_unit then 'NO PROFIT'
    when p.cost_per_unit = 0 then null
    when (p.offline_sp - p.cost_per_unit) / p.cost_per_unit >= 1 then '100% or More'
    else to_char(floor(((p.offline_sp - p.cost_per_unit) / p.cost_per_unit) * 100), 'FM999') || '%'
  end as percent_classification,
  case when p.cost_per_unit = 0 then 0
       else (p.offline_sp - p.cost_per_unit) / p.cost_per_unit
  end as raw_profit
from products p
left join sold sd on sd.product_id = p.id;

alter view v_product_analysis set (security_invoker = true);

comment on view v_product_analysis is 'Recomputes PA sheet logic from live transactional data. percent_classification mirrors workbook labels (NO PROFIT / 100% or More / percentage).';

-- ---------------------------------------------------------------------------
-- STOCK REGISTER — Opening + Purchased - Sold = Closing; Variance vs physical
-- ---------------------------------------------------------------------------
create view v_stock_register as
with movement_totals as (
  select
    product_id,
    sum(qty_delta) filter (where movement_type = 'OPENING')  as opening,
    sum(qty_delta) filter (where movement_type = 'PURCHASE') as purchased,
    -sum(qty_delta) filter (where movement_type = 'SALE')     as sold,   -- SALE rows are negative deltas; report as positive "sold"
    sum(qty_delta) filter (where movement_type = 'ADJUSTMENT') as adjustments
  from stock_movements
  group by product_id
),
latest_physical as (
  select distinct on (product_id) product_id, counted_qty, count_date
  from physical_stock_counts
  order by product_id, count_date desc, created_at desc
)
select
  p.id                          as product_id,
  p.product_name                as item,
  p.category,
  coalesce(mt.opening, 0)       as opening,
  coalesce(mt.purchased, 0)     as purchased,
  coalesce(mt.sold, 0)          as sold,
  coalesce(mt.opening,0) + coalesce(mt.purchased,0) - coalesce(mt.sold,0) + coalesce(mt.adjustments,0) as closing,
  lp.counted_qty                as physical_stock,
  lp.count_date                 as physical_count_date,
  case when lp.counted_qty is null then null
       else (coalesce(mt.opening,0) + coalesce(mt.purchased,0) - coalesce(mt.sold,0) + coalesce(mt.adjustments,0)) - lp.counted_qty
  end as variance,
  case
    when lp.counted_qty is null then null
    when (coalesce(mt.opening,0) + coalesce(mt.purchased,0) - coalesce(mt.sold,0) + coalesce(mt.adjustments,0)) - lp.counted_qty = 0 then 'OK'
    when abs((coalesce(mt.opening,0) + coalesce(mt.purchased,0) - coalesce(mt.sold,0) + coalesce(mt.adjustments,0)) - lp.counted_qty) <= 2 then 'Minor Issue'
    else 'SERIOUS LOSS'
  end as variance_status
from products p
left join movement_totals mt on mt.product_id = p.id
left join latest_physical lp on lp.product_id = p.id;

alter view v_stock_register set (security_invoker = true);

comment on view v_stock_register is 'Mirrors Stock Register sheet logic exactly, including OK / Minor Issue / SERIOUS LOSS thresholds (variance within 2 units = Minor Issue).';

-- ---------------------------------------------------------------------------
-- CUSTOMER CREDIT BALANCE
-- ---------------------------------------------------------------------------
create view v_customer_credit_balance as
select
  customer_id,
  sum(amount) as balance_due   -- positive = customer owes store
from credit_ledger
group by customer_id;

alter view v_customer_credit_balance set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- DAILY ACCOUNTS extended (profit % / raw profit per day, threshold flags)
-- ---------------------------------------------------------------------------
create view v_daily_accounts_extended as
select
  da.*,
  coalesce(daily_rev.revenue, 0)      as daily_revenue,
  coalesce(daily_rev.cost, 0)         as daily_cost,
  case when coalesce(daily_rev.revenue,0) = 0 then 0
       else (daily_rev.revenue - daily_rev.cost) / daily_rev.revenue
  end as profit_percent_per_day,
  coalesce(daily_rev.revenue, 0) - coalesce(daily_rev.cost, 0) as raw_profit_per_day,
  (da.day_total < 3000)               as below_3000_flag,
  (da.day_total >= 1500 and da.day_total <= 2500) as between_1500_2500_flag
from daily_accounts da
left join (
  select
    s.sale_date,
    sum(si.amount) as revenue,
    sum(si.qty * p.cost_per_unit) as cost
  from sales s
  join sale_items si on si.sale_id = s.id
  join products p on p.id = si.product_id
  where not s.is_voided
  group by s.sale_date
) daily_rev on daily_rev.sale_date = da.account_date;

alter view v_daily_accounts_extended set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- MONTHLY SUMMARY (aggregated live, not a stored/stale table)
-- ---------------------------------------------------------------------------
create view v_monthly_summary as
with months as (
  select date_trunc('month', d)::date as month_start
  from generate_series(
    (select coalesce(min(sale_date), current_date) from sales),
    current_date,
    interval '1 month'
  ) d
),
sales_by_month as (
  select date_trunc('month', s.sale_date)::date as month_start, sum(si.amount) as total_sales
  from sales s join sale_items si on si.sale_id = s.id
  where not s.is_voided
  group by 1
),
purchases_by_month as (
  select date_trunc('month', pu.purchase_date)::date as month_start, sum(pi.amount) as total_purchases
  from purchases pu join purchase_items pi on pi.purchase_id = pu.id
  where not pu.is_voided
  group by 1
),
expenses_by_month as (
  select date_trunc('month', coalesce(e.expense_date, e.created_at::date))::date as month_start, sum(e.amount) as total_expenses
  from expenses e
  where not e.is_voided
  group by 1
),
days_with_sales as (
  select date_trunc('month', s.sale_date)::date as month_start, count(distinct s.sale_date) as active_days
  from sales s where not s.is_voided group by 1
)
select
  m.month_start                                   as month,
  coalesce(sbm.total_sales, 0)                    as total_sales,
  coalesce(pbm.total_purchases, 0)                as total_purchases,
  coalesce(ebm.total_expenses, 0)                 as total_expenses,
  coalesce(sbm.total_sales,0) - coalesce(pbm.total_purchases,0) - coalesce(ebm.total_expenses,0) as net_profit,
  case when coalesce(dws.active_days,0) = 0 then 0
       else coalesce(sbm.total_sales,0) / dws.active_days
  end as daily_average,
  case when coalesce(sbm.total_sales,0) = 0 then null
       else (coalesce(sbm.total_sales,0) - coalesce(pbm.total_purchases,0) - coalesce(ebm.total_expenses,0)) / sbm.total_sales
  end as monthly_profit_percent
from months m
left join sales_by_month sbm on sbm.month_start = m.month_start
left join purchases_by_month pbm on pbm.month_start = m.month_start
left join expenses_by_month ebm on ebm.month_start = m.month_start
left join days_with_sales dws on dws.month_start = m.month_start
order by m.month_start;

alter view v_monthly_summary set (security_invoker = true);
