import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchProducts } from '@/services/salesService';
import { searchCustomers, createCustomer } from '@/services/customerService';
import { registerSale, generateBill } from '@/services/salesService';
import type { PaymentMode, ShiftType } from '@/types';

interface CartLine {
  product_id: string;
  product_name: string;
  qty: number;
  sold_inr: number;
}

interface ProductHit {
  id: string;
  product_name: string;
  category: string | null;
  mrp: number;
  offline_sp: number;
}

interface CustomerHit {
  id: string;
  full_name: string;
  phone: string | null;
}

export default function RegisterSale() {
  const navigate = useNavigate();

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerHit[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [shift, setShift] = useState<ShiftType | ''>('');
  const [customerRef, setCustomerRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBillId, setSuccessBillId] = useState<string | null>(null);

  async function handleProductSearch(q: string) {
    setProductQuery(q);
    if (q.trim().length < 2) {
      setProductResults([]);
      return;
    }
    try {
      const data = await searchProducts(q);
      setProductResults(data as ProductHit[]);
    } catch (e) {
      console.error(e);
    }
  }

  function addToCart(p: ProductHit) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product_id === p.id);
      if (existing) {
        return prev.map((c) => (c.product_id === p.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { product_id: p.id, product_name: p.product_name, qty: 1, sold_inr: p.offline_sp }];
    });
    setProductQuery('');
    setProductResults([]);
  }

  function updateCartLine(productId: string, field: 'qty' | 'sold_inr', value: number) {
    setCart((prev) => prev.map((c) => (c.product_id === productId ? { ...c, [field]: value } : c)));
  }

  function removeCartLine(productId: string) {
    setCart((prev) => prev.filter((c) => c.product_id !== productId));
  }

  async function handleCustomerSearch(q: string) {
    setCustomerQuery(q);
    setSelectedCustomer(null);
    if (q.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    try {
      const data = await searchCustomers(q);
      setCustomerResults(data as CustomerHit[]);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return;
    try {
      const c = await createCustomer({ fullName: newCustomerName.trim(), phone: newCustomerPhone.trim() || null });
      setSelectedCustomer({ id: c.id, full_name: c.full_name, phone: c.phone });
      setShowNewCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
    } catch (e: any) {
      setError(e.message ?? 'Failed to create customer');
    }
  }

  const total = cart.reduce((sum, c) => sum + c.qty * c.sold_inr, 0);
  const canSubmit = cart.length > 0 && (paymentMode !== 'CREDIT' || selectedCustomer) && !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const saleId = await registerSale({
        saleDate: new Date().toISOString().slice(0, 10),
        customerId: selectedCustomer?.id ?? null,
        customerRef: customerRef.trim() || null,
        paymentMode,
        shift: shift || null,
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty, sold_inr: c.sold_inr })),
      });
      const billId = await generateBill(saleId);
      setSuccessBillId(billId);
    } catch (e: any) {
      setError(e.message ?? 'Failed to register sale');
    } finally {
      setSubmitting(false);
    }
  }

  if (successBillId) {
    return (
      <div className="bg-white rounded-xl2 border border-gold/30 p-6 text-center shadow-sm">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="font-bold text-forest text-lg mb-1">Sale Registered</h2>
        <p className="text-sm text-darkest/60 mb-5">Bill generated successfully.</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => navigate(`/bills/${successBillId}`)}
            className="bg-gold text-darkest font-bold py-2.5 rounded-lg hover:bg-honey transition-colors"
          >
            View Bill
          </button>
          <button
            onClick={() => {
              setSuccessBillId(null);
              setCart([]);
              setSelectedCustomer(null);
              setCustomerRef('');
              setPaymentMode('CASH');
            }}
            className="text-evergreen font-semibold text-sm py-2"
          >
            Register another sale
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-forest">New Sale</h1>

      {error && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2">{error}</div>}

      {/* Product search */}
      <div>
        <label className="text-sm font-semibold text-darkest/80 block mb-1">Search Product</label>
        <input
          value={productQuery}
          onChange={(e) => handleProductSearch(e.target.value)}
          placeholder="Type an item name…"
          className="w-full rounded-lg border border-amber/40 px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold"
        />
        {productResults.length > 0 && (
          <div className="mt-1 bg-white border border-amber/30 rounded-lg shadow-sm max-h-56 overflow-y-auto divide-y divide-amber/10">
            {productResults.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="w-full text-left px-3 py-2 hover:bg-softgold/30 text-sm flex justify-between"
              >
                <span>{p.product_name}</span>
                <span className="text-forest font-semibold">₹{p.offline_sp}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <div className="bg-white rounded-xl2 border border-amber/20 divide-y divide-amber/10 shadow-sm">
          {cart.map((line) => (
            <div key={line.product_id} className="p-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{line.product_name}</div>
              </div>
              <input
                type="number"
                min={0.001}
                step="any"
                value={line.qty}
                onChange={(e) => updateCartLine(line.product_id, 'qty', Number(e.target.value))}
                className="w-16 border border-amber/30 rounded px-2 py-1 text-sm text-center"
              />
              <span className="text-darkest/40 text-xs">×</span>
              <input
                type="number"
                min={0}
                step="any"
                value={line.sold_inr}
                onChange={(e) => updateCartLine(line.product_id, 'sold_inr', Number(e.target.value))}
                className="w-20 border border-amber/30 rounded px-2 py-1 text-sm text-center"
              />
              <div className="w-16 text-right text-sm font-bold text-forest">₹{(line.qty * line.sold_inr).toFixed(0)}</div>
              <button onClick={() => removeCartLine(line.product_id)} className="text-packred text-lg leading-none px-1">
                ×
              </button>
            </div>
          ))}
          <div className="p-3 flex justify-between font-bold text-forest">
            <span>Total</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Customer */}
      <div>
        <label className="text-sm font-semibold text-darkest/80 block mb-1">Customer (optional)</label>
        {selectedCustomer ? (
          <div className="flex items-center justify-between bg-softgold/30 border border-amber/30 rounded-lg px-3 py-2">
            <span className="text-sm font-medium">{selectedCustomer.full_name}</span>
            <button onClick={() => setSelectedCustomer(null)} className="text-xs text-packred font-semibold">
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              value={customerQuery}
              onChange={(e) => handleCustomerSearch(e.target.value)}
              placeholder="Search customer by name…"
              className="w-full rounded-lg border border-amber/40 px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold"
            />
            {customerResults.length > 0 && (
              <div className="mt-1 bg-white border border-amber/30 rounded-lg shadow-sm divide-y divide-amber/10">
                {customerResults.map((c) => (
                  <button key={c.id} onClick={() => setSelectedCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-softgold/30 text-sm">
                    {c.full_name} {c.phone ? `· ${c.phone}` : ''}
                  </button>
                ))}
              </div>
            )}
            {!showNewCustomer ? (
              <button onClick={() => setShowNewCustomer(true)} className="text-xs text-evergreen font-semibold mt-1 hover:underline">
                + Add new customer
              </button>
            ) : (
              <div className="mt-2 bg-white border border-amber/30 rounded-lg p-3 space-y-2">
                <input
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name"
                  className="w-full border border-amber/30 rounded px-2 py-1.5 text-sm"
                />
                <input
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  placeholder="Phone / WhatsApp (optional)"
                  className="w-full border border-amber/30 rounded px-2 py-1.5 text-sm"
                />
                <button onClick={handleCreateCustomer} className="text-xs bg-forest text-cream font-semibold px-3 py-1.5 rounded">
                  Save Customer
                </button>
              </div>
            )}
            <input
              value={customerRef}
              onChange={(e) => setCustomerRef(e.target.value)}
              placeholder="Or a quick reference tag (e.g. 'Grocery', 'Walk-in')"
              className="w-full rounded-lg border border-amber/20 px-3 py-2 mt-2 text-sm bg-cream/50"
            />
          </>
        )}
      </div>

      {/* Payment mode */}
      <div>
        <label className="text-sm font-semibold text-darkest/80 block mb-1">Payment Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {(['CASH', 'UPI', 'CREDIT'] as PaymentMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setPaymentMode(mode)}
              className={`py-2 rounded-lg text-sm font-bold border-2 transition-colors ${
                paymentMode === mode ? 'bg-forest text-cream border-forest' : 'bg-white text-darkest/70 border-amber/30'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        {paymentMode === 'CREDIT' && !selectedCustomer && (
          <p className="text-xs text-packred mt-1">A customer must be selected for a credit sale.</p>
        )}
      </div>

      {/* Shift */}
      <div>
        <label className="text-sm font-semibold text-darkest/80 block mb-1">Shift (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          {(['MORNING', 'EVENING'] as ShiftType[]).map((s) => (
            <button
              key={s}
              onClick={() => setShift(shift === s ? '' : s)}
              className={`py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                shift === s ? 'bg-evergreen text-cream border-evergreen' : 'bg-white text-darkest/70 border-amber/30'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full bg-gold text-darkest font-bold py-3 rounded-xl2 shadow hover:bg-honey transition-colors disabled:opacity-50"
      >
        {submitting ? 'Registering…' : `Register Sale · ₹${total.toFixed(2)}`}
      </button>
    </div>
  );
}
