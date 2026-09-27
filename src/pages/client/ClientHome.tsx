import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getMySalesRegister } from '@/services/salesService';
import type { SaleRegisterRow } from '@/types';

export default function ClientHome() {
  const { profile } = useAuth();
  const [recent, setRecent] = useState<SaleRegisterRow[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMySalesRegister(10, 0)
      .then(({ rows }) => {
        setRecent(rows as SaleRegisterRow[]);
        const today = new Date().toISOString().slice(0, 10);
        const total = (rows as SaleRegisterRow[])
          .filter((r) => r.sale_date === today)
          .reduce((sum, r) => sum + Number(r.amount), 0);
        setTodayTotal(total);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-forest">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
        <p className="text-sm text-darkest/60">Here's your sales activity.</p>
      </div>

      <div className="bg-forest text-cream rounded-xl2 p-5 shadow-md border border-gold/30">
        <div className="text-xs uppercase tracking-wide text-honey font-semibold">Today's Sales</div>
        <div className="text-3xl font-extrabold mt-1">₹{todayTotal.toFixed(2)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/sale/new" className="bg-gold text-darkest rounded-xl2 p-4 font-bold text-center shadow hover:bg-honey transition-colors">
          + New Sale
        </Link>
        <Link to="/customers" className="bg-white border-2 border-amber/30 rounded-xl2 p-4 font-bold text-center text-forest shadow-sm hover:border-amber transition-colors">
          Customers
        </Link>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-forest text-sm">Recent Sales</h2>
          <Link to="/sales" className="text-xs text-evergreen font-semibold hover:underline">
            View all
          </Link>
        </div>
        {loading ? (
          <div className="text-sm text-darkest/50">Loading…</div>
        ) : recent.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white rounded-xl2 border border-amber/20 divide-y divide-amber/10 overflow-hidden shadow-sm">
            {recent.slice(0, 5).map((r) => (
              <div key={r.sale_item_id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium text-darkest">{r.item}</div>
                  <div className="text-xs text-darkest/50">
                    {r.sale_date} · {r.qty} × ₹{r.sold_inr}
                  </div>
                </div>
                <div className="font-bold text-forest">₹{Number(r.amount).toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl2 border border-dashed border-amber/30 p-6 text-center text-sm text-darkest/50">
      No sales yet. Tap <span className="font-semibold text-forest">+ New Sale</span> to record your first one.
    </div>
  );
}
