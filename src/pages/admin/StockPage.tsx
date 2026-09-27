import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { StockRegisterRow } from '@/types';

export default function StockPage() {
  const [rows, setRows] = useState<StockRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'ISSUES'>('ALL');

  useEffect(() => {
    supabase
      .rpc('get_stock_register')
      .then(({ data }) => setRows((data as StockRegisterRow[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  const filtered = filter === 'ISSUES' ? rows.filter((r) => r.variance_status && r.variance_status !== 'OK') : rows;

  const statusColor: Record<string, string> = {
    OK: 'bg-fresh/10 text-fresh',
    'Minor Issue': 'bg-amber/10 text-amber',
    'SERIOUS LOSS': 'bg-packred/10 text-packred',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-forest">Stock Register</h1>
          <p className="text-sm text-darkest/60">Closing = Opening + Purchased − Sold, recomputed from the stock ledger.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('ALL')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${filter === 'ALL' ? 'bg-forest text-cream' : 'bg-white border border-amber/30'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('ISSUES')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${filter === 'ISSUES' ? 'bg-forest text-cream' : 'bg-white border border-amber/30'}`}
          >
            Variance Issues
          </button>
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.product_id}
        columns={[
          { header: 'Item', accessor: (r) => r.item },
          { header: 'Category', accessor: (r) => r.category ?? '—' },
          { header: 'Opening', accessor: (r) => r.opening, align: 'right' },
          { header: 'Purchased', accessor: (r) => r.purchased, align: 'right' },
          { header: 'Sold', accessor: (r) => r.sold, align: 'right' },
          { header: 'Closing', accessor: (r) => r.closing, align: 'right' },
          { header: 'Physical', accessor: (r) => r.physical_stock ?? '—', align: 'right' },
          { header: 'Variance', accessor: (r) => r.variance ?? '—', align: 'right' },
          {
            header: 'Status',
            accessor: (r) =>
              r.variance_status ? (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColor[r.variance_status]}`}>{r.variance_status}</span>
              ) : (
                <span className="text-xs text-darkest/40">No count yet</span>
              ),
          },
        ]}
      />
    </div>
  );
}
