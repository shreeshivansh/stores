import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { MonthlySummaryRow } from '@/types';

function formatMonth(monthStr: string) {
  const d = new Date(monthStr);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export default function MonthlySummaryPage() {
  const [rows, setRows] = useState<MonthlySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // get_monthly_summary() is admin-gated server-side (raises if !is_admin()),
    // and v_monthly_summary itself is revoked from `authenticated` directly —
    // this RPC is the only path to this aggregate (see 0003/0004 migrations).
    supabase
      .rpc('get_monthly_summary')
      .then(({ data }) => setRows(((data as MonthlySummaryRow[]) ?? []).slice().reverse()))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  const totals = rows.reduce(
    (acc, r) => ({
      total_sales: acc.total_sales + Number(r.total_sales),
      total_purchases: acc.total_purchases + Number(r.total_purchases),
      total_expenses: acc.total_expenses + Number(r.total_expenses),
      net_profit: acc.net_profit + Number(r.net_profit),
    }),
    { total_sales: 0, total_purchases: 0, total_expenses: 0, net_profit: 0 }
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Monthly Summary</h1>
        <p className="text-sm text-darkest/60">Net Profit = Sales − Purchases − Expenses, aggregated live per calendar month.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Sales" value={totals.total_sales} color="bg-evergreen" />
        <SummaryCard label="Total Purchases" value={totals.total_purchases} color="bg-spiced" />
        <SummaryCard label="Total Expenses" value={totals.total_expenses} color="bg-deepbrown" />
        <SummaryCard label="Net Profit" value={totals.net_profit} color={totals.net_profit >= 0 ? 'bg-fresh' : 'bg-packred'} />
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(r) => r.month}
        columns={[
          { header: 'Month', accessor: (r) => formatMonth(r.month) },
          { header: 'Sales', accessor: (r) => `₹${Number(r.total_sales).toFixed(2)}`, align: 'right' },
          { header: 'Purchases', accessor: (r) => `₹${Number(r.total_purchases).toFixed(2)}`, align: 'right' },
          { header: 'Expenses', accessor: (r) => `₹${Number(r.total_expenses).toFixed(2)}`, align: 'right' },
          {
            header: 'Net Profit',
            align: 'right',
            accessor: (r) => (
              <span className={`font-bold ${Number(r.net_profit) >= 0 ? 'text-fresh' : 'text-packred'}`}>₹{Number(r.net_profit).toFixed(2)}</span>
            ),
          },
          { header: 'Daily Avg', accessor: (r) => `₹${Number(r.daily_average).toFixed(2)}`, align: 'right' },
          {
            header: 'Profit %',
            align: 'right',
            accessor: (r) => (r.monthly_profit_percent == null ? '—' : `${(Number(r.monthly_profit_percent) * 100).toFixed(1)}%`),
          },
        ]}
      />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} text-cream rounded-xl2 p-4 shadow-sm`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xl font-extrabold mt-1">₹{value.toFixed(2)}</div>
    </div>
  );
}
