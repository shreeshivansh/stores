import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { SaleRegisterRow, Profile } from '@/types';

interface GroupedSale {
  sale_id: string;
  sale_date: string;
  customer_display: string | null;
  payment_mode: string;
  shift: string | null;
  created_by: string;
  bill_id: string | null;
  is_voided: boolean;
  total: number;
  items: string[];
}

function groupBySale(rows: SaleRegisterRow[]): GroupedSale[] {
  const map = new Map<string, GroupedSale>();
  for (const r of rows) {
    if (!map.has(r.sale_id)) {
      map.set(r.sale_id, {
        sale_id: r.sale_id,
        sale_date: r.sale_date,
        customer_display: r.customer_display,
        payment_mode: r.payment_mode,
        shift: r.shift,
        created_by: r.created_by,
        bill_id: r.bill_id,
        is_voided: r.is_voided,
        total: 0,
        items: [],
      });
    }
    const entry = map.get(r.sale_id)!;
    entry.total += Number(r.amount);
    entry.items.push(`${r.item} (${r.qty})`);
  }
  return Array.from(map.values()).sort((a, b) => (a.sale_date < b.sale_date ? 1 : -1));
}

export default function AdminSalesPage() {
  const [rows, setRows] = useState<SaleRegisterRow[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userFilter, setUserFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    Promise.all([
      // Admin RLS policy (sales_admin_all / sale_items_admin_all) returns
      // every user's rows here — no per-user filtering happens client-side
      // for security, only for display.
      supabase.from('v_sales_register').select('*').order('sale_date', { ascending: false }).limit(5000),
      supabase.from('profiles').select('id, full_name, phone, role, is_active, created_at'),
    ])
      .then(([salesRes, profilesRes]) => {
        setRows((salesRes.data as SaleRegisterRow[]) ?? []);
        setStaff((profilesRes.data as Profile[]) ?? []);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of staff) map.set(p.id, p.full_name ?? p.id.slice(0, 8));
    return map;
  }, [staff]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (dateFrom && r.sale_date < dateFrom) return false;
      if (dateTo && r.sale_date > dateTo) return false;
      if (userFilter !== 'ALL' && r.created_by !== userFilter) return false;
      if (paymentFilter !== 'ALL' && r.payment_mode !== paymentFilter) return false;
      return true;
    });
  }, [rows, dateFrom, dateTo, userFilter, paymentFilter]);

  const grouped = useMemo(() => groupBySale(filtered), [filtered]);
  const grandTotal = grouped.reduce((sum, g) => sum + (g.is_voided ? 0 : g.total), 0);

  async function handleVoid(saleId: string) {
    if (!voidReason.trim()) {
      setActionError('A reason is required to void a sale.');
      return;
    }
    setActionError(null);
    try {
      const { error } = await supabase.rpc('void_sale', { p_sale_id: saleId, p_reason: voidReason.trim() });
      if (error) throw error;
      setVoidingId(null);
      setVoidReason('');
      load();
    } catch (e: any) {
      setActionError(e.message ?? 'Failed to void sale');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-forest">Sales (All Users)</h1>
          <p className="text-sm text-darkest/60">Every sale across every staff account — admin RLS returns all rows, not just your own.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-darkest/50">Filtered Total</div>
          <div className="text-lg font-extrabold text-forest">₹{grandTotal.toFixed(2)}</div>
        </div>
      </div>

      {actionError && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2">{actionError}</div>}

      <div className="flex flex-wrap gap-2">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white" />
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="ALL">All Staff</option>
          {staff.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name ?? p.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="ALL">All Payment Modes</option>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CREDIT">Credit</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        rows={grouped}
        rowKey={(r) => r.sale_id}
        columns={[
          { header: 'Date', accessor: (r) => r.sale_date },
          { header: 'Staff', accessor: (r) => staffNameById.get(r.created_by) ?? '—' },
          { header: 'Customer', accessor: (r) => r.customer_display ?? 'Walk-in' },
          { header: 'Items', accessor: (r) => <span className="text-xs">{r.items.join(', ')}</span> },
          { header: 'Payment', accessor: (r) => r.payment_mode },
          { header: 'Shift', accessor: (r) => r.shift ?? '—' },
          {
            header: 'Total',
            align: 'right',
            accessor: (r) => <span className={r.is_voided ? 'line-through text-darkest/40' : 'font-bold text-forest'}>₹{r.total.toFixed(2)}</span>,
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
              <div className="flex items-center gap-2 whitespace-nowrap">
                {r.bill_id && (
                  <Link to={`/admin/bills/${r.bill_id}`} className="text-xs text-evergreen font-semibold hover:underline">
                    View Bill
                  </Link>
                )}
                {!r.is_voided &&
                  (voidingId === r.sale_id ? (
                    <span className="flex items-center gap-1">
                      <input
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        placeholder="Reason…"
                        className="border border-amber/30 rounded px-2 py-1 text-xs w-28"
                      />
                      <button onClick={() => handleVoid(r.sale_id)} className="text-xs font-bold text-packred">
                        Confirm
                      </button>
                      <button
                        onClick={() => {
                          setVoidingId(null);
                          setVoidReason('');
                        }}
                        className="text-xs text-darkest/50"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setVoidingId(r.sale_id)} className="text-xs font-semibold text-packred hover:underline">
                      Void
                    </button>
                  ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
