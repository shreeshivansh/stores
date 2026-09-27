import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Bill } from '@/types';

export default function BillsList() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // RLS (bills_client_select_own) scopes this to the signed-in user's own bills.
    supabase
      .from('bills')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setBills((data as Bill[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-forest">My Bills</h1>
      {loading ? (
        <div className="text-center text-darkest/50 py-8">Loading…</div>
      ) : bills.length === 0 ? (
        <div className="bg-white rounded-xl2 border border-dashed border-amber/30 p-6 text-center text-sm text-darkest/50">
          No bills yet.
        </div>
      ) : (
        <div className="space-y-2">
          {bills.map((b) => (
            <Link
              key={b.id}
              to={`/bills/${b.id}`}
              className="block bg-white rounded-xl2 border border-amber/20 p-3 shadow-sm hover:border-gold transition-colors"
            >
              <div className="flex justify-between">
                <div>
                  <div className="text-sm font-semibold">{b.bill_number}</div>
                  <div className="text-xs text-darkest/50">{b.bill_date}</div>
                </div>
                <div className="font-bold text-forest">₹{Number(b.total_amount).toFixed(2)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
