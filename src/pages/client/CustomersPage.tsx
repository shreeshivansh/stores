import { useEffect, useState } from 'react';
import { searchCustomers, getCustomerCreditBalance, recordCreditPayment } from '@/services/customerService';

interface CustomerRow {
  id: string;
  full_name: string;
  phone: string | null;
  balance?: number;
}

export default function CustomersPage() {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [payingFor, setPayingFor] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  useEffect(() => {
    loadCustomers('');
  }, []);

  async function loadCustomers(q: string) {
    setLoading(true);
    try {
      const data = await searchCustomers(q);
      const withBalances = await Promise.all(
        data.map(async (c: any) => ({ ...c, balance: await getCustomerCreditBalance(c.id) }))
      );
      setCustomers(withBalances);
    } finally {
      setLoading(false);
    }
  }

  async function handlePayment(customerId: string) {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) return;
    await recordCreditPayment(customerId, amt);
    setPayingFor(null);
    setPaymentAmount('');
    loadCustomers(query);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-forest">Customers</h1>

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          loadCustomers(e.target.value);
        }}
        placeholder="Search customers…"
        className="w-full rounded-lg border border-amber/40 px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold"
      />

      {loading ? (
        <div className="text-center text-darkest/50 py-8">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-xl2 border border-dashed border-amber/30 p-6 text-center text-sm text-darkest/50">
          No customers found. New customers are added from the New Sale screen.
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <div key={c.id} className="bg-white rounded-xl2 border border-amber/20 p-3 shadow-sm">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-sm">{c.full_name}</div>
                  {c.phone && <div className="text-xs text-darkest/50">{c.phone}</div>}
                </div>
                {c.balance != null && c.balance > 0 && (
                  <div className="text-right">
                    <div className="text-xs text-packred font-bold">Owes ₹{c.balance.toFixed(2)}</div>
                    <button onClick={() => setPayingFor(c.id)} className="text-xs text-evergreen font-semibold hover:underline">
                      Record payment
                    </button>
                  </div>
                )}
              </div>
              {payingFor === c.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Amount"
                    className="flex-1 border border-amber/30 rounded px-2 py-1.5 text-sm"
                  />
                  <button onClick={() => handlePayment(c.id)} className="bg-forest text-cream text-xs font-semibold px-3 py-1.5 rounded">
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
