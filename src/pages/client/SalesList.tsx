import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMySalesRegister } from '@/services/salesService';
import { exportSalesRegisterToXlsx } from '@/lib/exportXlsx';
import type { SaleRegisterRow } from '@/types';

const PAGE_SIZE = 25;

export default function SalesList() {
  const [rows, setRows] = useState<SaleRegisterRow[]>([]);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    getMySalesRegister(PAGE_SIZE, page * PAGE_SIZE)
      .then(({ rows, count }) => {
        setRows(rows as SaleRegisterRow[]);
        setCount(count);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, [page]);

  const filtered = dateFilter ? rows.filter((r) => r.sale_date === dateFilter) : rows;
  const groupedBySale = groupBySale(filtered);

  async function handleExport() {
    // Exports only what's already been fetched via RLS-scoped queries above.
    const { rows: allRows } = await getMySalesRegister(5000, 0);
    exportSalesRegisterToXlsx(allRows as SaleRegisterRow[]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-forest">My Sales Register</h1>
        <button onClick={handleExport} className="text-xs bg-forest text-cream font-semibold px-3 py-1.5 rounded-lg">
          Export XLSX
        </button>
      </div>

      <input
        type="date"
        value={dateFilter}
        onChange={(e) => setDateFilter(e.target.value)}
        className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white"
      />

      {loading ? (
        <div className="text-center text-darkest/50 py-8">Loading…</div>
      ) : groupedBySale.length === 0 ? (
        <div className="bg-white rounded-xl2 border border-dashed border-amber/30 p-6 text-center text-sm text-darkest/50">
          No sales found.
        </div>
      ) : (
        <div className="space-y-2">
          {groupedBySale.map((sale) => (
            <div key={sale.sale_id} className="bg-white rounded-xl2 border border-amber/20 p-3 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-semibold">{sale.sale_date}</div>
                  <div className="text-xs text-darkest/50">
                    {sale.customer_display ?? 'Walk-in'} · {sale.payment_mode}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-forest">₹{sale.total.toFixed(2)}</div>
                  {sale.bill_id && (
                    <Link to={`/bills/${sale.bill_id}`} className="text-xs text-evergreen font-semibold hover:underline">
                      View Bill
                    </Link>
                  )}
                </div>
              </div>
              <div className="text-xs text-darkest/60 mt-1">{sale.items.join(', ')}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center pt-2">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="text-sm font-semibold text-evergreen disabled:opacity-30">
          ← Prev
        </button>
        <span className="text-xs text-darkest/50">
          Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}
        </span>
        <button
          disabled={(page + 1) * PAGE_SIZE >= count}
          onClick={() => setPage((p) => p + 1)}
          className="text-sm font-semibold text-evergreen disabled:opacity-30"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function groupBySale(rows: SaleRegisterRow[]) {
  const map = new Map<string, { sale_id: string; sale_date: string; customer_display: string | null; payment_mode: string; bill_id: string | null; total: number; items: string[] }>();
  for (const r of rows) {
    if (!map.has(r.sale_id)) {
      map.set(r.sale_id, {
        sale_id: r.sale_id,
        sale_date: r.sale_date,
        customer_display: r.customer_display,
        payment_mode: r.payment_mode,
        bill_id: r.bill_id,
        total: 0,
        items: [],
      });
    }
    const entry = map.get(r.sale_id)!;
    entry.total += Number(r.amount);
    entry.items.push(r.item);
  }
  return Array.from(map.values());
}
