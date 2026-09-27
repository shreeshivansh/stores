import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { Bill, Profile } from '@/types';

export default function AdminBillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    // Admin RLS (bills_admin_all) returns bills for every staff account.
    Promise.all([
      supabase.from('bills').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('profiles').select('id, full_name, phone, role, is_active, created_at'),
    ])
      .then(([billsRes, profilesRes]) => {
        setBills((billsRes.data as Bill[]) ?? []);
        setStaff((profilesRes.data as Profile[]) ?? []);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of staff) map.set(p.id, p.full_name ?? p.id.slice(0, 8));
    return map;
  }, [staff]);

  const filtered = bills.filter((b) => {
    if (search && !b.bill_number.toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom && b.bill_date < dateFrom) return false;
    if (dateTo && b.bill_date > dateTo) return false;
    return true;
  });

  const total = filtered.reduce((sum, b) => sum + (b.is_voided ? 0 : Number(b.total_amount)), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-forest">Bills (All)</h1>
          <p className="text-sm text-darkest/60">Every generated bill, across all staff accounts.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-darkest/50">Filtered Total</div>
          <div className="text-lg font-extrabold text-forest">₹{total.toFixed(2)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bill number…"
          className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white" />
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        columns={[
          { header: 'Bill No.', accessor: (r) => r.bill_number },
          { header: 'Date', accessor: (r) => r.bill_date },
          { header: 'Staff', accessor: (r) => staffNameById.get(r.created_by) ?? '—' },
          { header: 'Payment', accessor: (r) => r.payment_mode },
          { header: 'Subtotal', accessor: (r) => `₹${Number(r.subtotal).toFixed(2)}`, align: 'right' },
          { header: 'Saved', accessor: (r) => `₹${Number(r.saved_amount).toFixed(2)}`, align: 'right' },
          {
            header: 'Total',
            align: 'right',
            accessor: (r) => <span className={r.is_voided ? 'line-through text-darkest/40' : 'font-bold text-forest'}>₹{Number(r.total_amount).toFixed(2)}</span>,
          },
          {
            header: 'Status',
            accessor: (r) =>
              r.is_voided ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-packred/10 text-packred">Voided</span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-fresh/10 text-fresh">Active</span>
              ),
          },
          {
            header: 'Actions',
            accessor: (r) => (
              <Link to={`/admin/bills/${r.id}`} className="text-xs text-evergreen font-semibold hover:underline">
                View
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}
