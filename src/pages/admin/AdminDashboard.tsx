import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Kpis {
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  netProfit: number;
  outstandingCredit: number;
  lowStockCount: number;
}

export default function AdminDashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [monthly, credit, stock] = await Promise.all([
        supabase.rpc('get_monthly_summary'),
        supabase.from('v_customer_credit_balance').select('balance_due'),
        supabase.rpc('get_stock_register'),
      ]);

      const monthRows = monthly.data ?? [];
      const totals = monthRows.reduce(
        (acc: any, r: any) => ({
          totalSales: acc.totalSales + Number(r.total_sales),
          totalPurchases: acc.totalPurchases + Number(r.total_purchases),
          totalExpenses: acc.totalExpenses + Number(r.total_expenses),
          netProfit: acc.netProfit + Number(r.net_profit),
        }),
        { totalSales: 0, totalPurchases: 0, totalExpenses: 0, netProfit: 0 }
      );

      const outstandingCredit = (credit.data ?? []).reduce((sum: number, r: any) => sum + Math.max(0, Number(r.balance_due)), 0);
      const lowStockCount = (stock.data ?? []).filter((r: any) => Number(r.closing) <= 5).length;

      setKpis({ ...totals, outstandingCredit, lowStockCount });
      setLoading(false);
    }
    load();
  }, []);

  if (loading || !kpis) return <div className="text-darkest/50">Loading dashboard…</div>;

  const cards = [
    { label: 'Total Sales', value: kpis.totalSales, color: 'bg-evergreen' },
    { label: 'Total Purchases', value: kpis.totalPurchases, color: 'bg-spiced' },
    { label: 'Total Expenses', value: kpis.totalExpenses, color: 'bg-deepbrown' },
    { label: 'Net Profit', value: kpis.netProfit, color: kpis.netProfit >= 0 ? 'bg-fresh' : 'bg-packred' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-forest">Admin Dashboard</h1>
        <p className="text-sm text-darkest/60">All-time totals derived live from transactional records.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className={`${c.color} text-cream rounded-xl2 p-4 shadow-sm`}>
            <div className="text-xs uppercase tracking-wide opacity-80">{c.label}</div>
            <div className="text-xl font-extrabold mt-1">₹{c.value.toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl2 border border-amber/20 p-4 shadow-sm">
          <div className="text-sm font-semibold text-darkest/70">Outstanding Credit</div>
          <div className="text-2xl font-extrabold text-packred mt-1">₹{kpis.outstandingCredit.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl2 border border-amber/20 p-4 shadow-sm">
          <div className="text-sm font-semibold text-darkest/70">Low Stock Items (≤5 units)</div>
          <div className="text-2xl font-extrabold text-amber mt-1">{kpis.lowStockCount}</div>
        </div>
      </div>
    </div>
  );
}
