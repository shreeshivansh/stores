import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { Customer } from '@/types';

interface CustomerWithBalance extends Customer {
  balance_due: number;
}

export default function AdminCustomersPage() {
  const [rows, setRows] = useState<CustomerWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [payingFor, setPayingFor] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    // Admin RLS (customers_admin_all) returns every customer, regardless of
    // which staff account created them.
    Promise.all([
      supabase.from('customers').select('*').order('full_name'),
      supabase.from('v_customer_credit_balance').select('*'),
    ])
      .then(([customersRes, balancesRes]) => {
        const balanceMap = new Map<string, number>();
        for (const b of (balancesRes.data as { customer_id: string; balance_due: number }[]) ?? []) {
          balanceMap.set(b.customer_id, Number(b.balance_due));
        }
        const merged = ((customersRes.data as Customer[]) ?? []).map((c) => ({
          ...c,
          balance_due: balanceMap.get(c.id) ?? 0,
        }));
        setRows(merged);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }

  const filtered = rows.filter(
    (r) =>
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.phone ?? '').includes(search) ||
      (r.reference ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const totalOutstanding = rows.reduce((sum, r) => sum + Math.max(0, r.balance_due), 0);

  async function handlePayment(customerId: string) {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) {
      setActionError('Enter a valid payment amount.');
      return;
    }
    setActionError(null);
    try {
      // record_credit_payment() is authorized for admins (is_admin() check
      // inside the function alongside the created_by check) so this works
      // for any customer, not just ones the admin personally created.
      await supabase.rpc('record_credit_payment', { p_customer_id: customerId, p_amount: amt, p_note: note.trim() || null });
      setPayingFor(null);
      setPaymentAmount('');
      setNote('');
      load();
    } catch (e: any) {
      setActionError(e.message ?? 'Failed to record payment');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-forest">Customers (All)</h1>
          <p className="text-sm text-darkest/60">Every customer across all staff accounts, with live credit balances.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-darkest/50">Total Outstanding Credit</div>
          <div className="text-lg font-extrabold text-packred">₹{totalOutstanding.toFixed(2)}</div>
        </div>
      </div>

      {actionError && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2">{actionError}</div>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, phone, or reference…"
        className="border border-amber/30 rounded-lg px-3 py-2 text-sm w-full max-w-sm bg-white"
      />

      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        columns={[
          { header: 'Name', accessor: (r) => r.full_name },
          { header: 'Phone', accessor: (r) => r.phone ?? '—' },
          { header: 'WhatsApp', accessor: (r) => r.whatsapp ?? '—' },
          { header: 'Reference', accessor: (r) => r.reference ?? '—' },
          { header: 'Address', accessor: (r) => <span className="text-xs">{r.address ?? '—'}</span> },
          {
            header: 'Balance Due',
            align: 'right',
            accessor: (r) =>
              r.balance_due > 0 ? (
                <span className="font-bold text-packred">₹{r.balance_due.toFixed(2)}</span>
              ) : (
                <span className="text-darkest/40">₹0.00</span>
              ),
          },
          {
            header: 'Actions',
            accessor: (r) =>
              r.balance_due > 0 ? (
                payingFor === r.id ? (
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="Amount"
                      className="w-20 border border-amber/30 rounded px-2 py-1 text-xs"
                    />
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-24 border border-amber/30 rounded px-2 py-1 text-xs"
                    />
                    <button onClick={() => handlePayment(r.id)} className="text-xs font-bold text-fresh">
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setPayingFor(null);
                        setPaymentAmount('');
                        setNote('');
                      }}
                      className="text-xs text-darkest/50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setPayingFor(r.id)} className="text-xs font-semibold text-evergreen hover:underline">
                    Record payment
                  </button>
                )
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
