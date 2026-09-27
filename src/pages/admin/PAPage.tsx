import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { ProductAnalysisRow } from '@/types';

const CLASSIFICATION_TOOLTIPS: Record<string, string> = {
  'NO PROFIT': 'Selling price is at or below cost per unit — this item is being sold at a loss or break-even.',
  '100% or More': 'Margin is 100% or higher relative to cost — a very high-margin item.',
};

export default function PAPage() {
  const [rows, setRows] = useState<ProductAnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase
      .rpc('get_product_analysis')
      .then(({ data }) => setRows((data as ProductAnalysisRow[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  const filtered = rows.filter((r) => r.product_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Product Analysis (PA)</h1>
        <p className="text-sm text-darkest/60">Recomputed live from products + sales — never a stale spreadsheet snapshot.</p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search product…"
        className="border border-amber/30 rounded-lg px-3 py-2 text-sm w-full max-w-sm bg-white"
      />

      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.product_id}
        columns={[
          { header: 'Product', accessor: (r) => r.product_name },
          { header: 'Category', accessor: (r) => r.category ?? '—' },
          { header: 'MRP', accessor: (r) => `₹${r.mrp}`, align: 'right' },
          { header: 'Cost/Unit', accessor: (r) => `₹${r.cost_per_unit}`, align: 'right' },
          { header: 'Offline SP', accessor: (r) => `₹${r.offline_sp}`, align: 'right' },
          { header: 'Qty Sold', accessor: (r) => r.quantity_sold, align: 'right' },
          { header: 'Revenue', accessor: (r) => `₹${r.revenue.toFixed(2)}`, align: 'right' },
          { header: 'Gross Profit', accessor: (r) => `₹${r.gross_profit.toFixed(2)}`, align: 'right' },
          { header: 'Profit %', accessor: (r) => `${(r.profit_pct * 100).toFixed(1)}%`, align: 'right' },
          {
            header: 'Classification',
            accessor: (r) => (
              <span
                title={CLASSIFICATION_TOOLTIPS[r.percent_classification ?? ''] ?? ''}
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  r.percent_classification === 'NO PROFIT'
                    ? 'bg-packred/10 text-packred'
                    : r.percent_classification === '100% or More'
                    ? 'bg-fresh/10 text-fresh'
                    : 'bg-amber/10 text-amber'
                }`}
              >
                {r.percent_classification ?? '—'}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
