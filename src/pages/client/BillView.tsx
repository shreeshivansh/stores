import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getBillWithItems } from '@/services/salesService';
import { buildWhatsAppLink, buildWhatsAppMessage, shareOrDownloadBillPdf } from '@/lib/whatsapp';
import { supabase } from '@/lib/supabase';

const DEFAULT_TEMPLATE =
  "Hello {{customer_name}}, thank you for shopping at {{store_name}}!\n\nBill No: {{bill_number}}\nDate: {{bill_date}}\nItems: {{item_summary}}\nTotal: {{currency_symbol}}{{total_amount}}\n\nThank you for your business!";

export default function BillView() {
  const { billId } = useParams<{ billId: string }>();
  const [data, setData] = useState<Awaited<ReturnType<typeof getBillWithItems>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const billRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!billId) return;
    getBillWithItems(billId)
      .then(setData)
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, [billId]);

  if (loading) return <div className="text-center py-10 text-darkest/50">Loading bill…</div>;
  if (!data) return <div className="text-center py-10 text-packred">Bill not found or you don't have access to it.</div>;

  const { bill, items, customer } = data;

  function handlePrint() {
    window.print();
  }

  async function handleShareWhatsApp() {
    const { data: settingsRow } = await supabase.from('app_settings').select('value').eq('key', 'whatsapp_template').maybeSingle();
    const template = (settingsRow?.value as any)?.template ?? DEFAULT_TEMPLATE;

    const message = buildWhatsAppMessage(template, {
      storeName: 'Shree Shivansh Stores',
      billNumber: bill.bill_number,
      billDate: bill.bill_date,
      customerName: customer?.full_name ?? 'Customer',
      totalAmount: bill.total_amount,
      currencySymbol: '₹',
      itemSummary: `${items.length} item${items.length === 1 ? '' : 's'}`,
      billLink: window.location.href,
    });

    const phone = customer?.whatsapp || customer?.phone;
    const link = buildWhatsAppLink(phone, message);
    if (link) {
      window.open(link, '_blank');
    } else {
      await navigator.clipboard.writeText(message);
      setShareStatus('No WhatsApp number on file for this customer — message copied to clipboard instead.');
    }
  }

  async function handleDownload() {
    // Client-side PDF generation from the printable bill markup.
    setShareStatus('Preparing PDF…');
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');
    if (!billRef.current) return;
    const canvas = await html2canvas(billRef.current, { scale: 2, backgroundColor: '#FAF5E6' });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, imgHeight);
    const blob = pdf.output('blob');
    const result = await shareOrDownloadBillPdf(blob, `${bill.bill_number}.pdf`);
    setShareStatus(result === 'shared' ? 'Bill shared.' : 'Bill PDF downloaded.');
  }

  return (
    <div className="space-y-4">
      <div ref={billRef} className="bg-cream border-2 border-gold/40 rounded-xl2 p-5 shadow-sm print:shadow-none print:border-none">
        <div className="text-center border-b-2 border-evergreen pb-3 mb-3">
          <h1 className="font-extrabold text-forest text-lg">SHREE SHIVANSH STORES</h1>
          <p className="text-xs text-darkest/60 mt-1">
            Shibnagar College Road Extension, Behind Ananda Marga School
            <br />
            P.O: Agartala College 799004
          </p>
        </div>

        <div className="flex justify-between text-sm mb-3">
          <div>
            <div className="font-semibold">e-Bill No: {bill.bill_number}</div>
            {customer && <div className="text-darkest/60">Customer: {customer.full_name}</div>}
          </div>
          <div className="text-right text-darkest/60">Date: {bill.bill_date}</div>
        </div>

        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="border-b border-amber/40 text-left">
              <th className="py-1">#</th>
              <th className="py-1">Item</th>
              <th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">MRP</th>
              <th className="py-1 text-right">Rate</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, idx: number) => (
              <tr key={idx} className="border-b border-amber/10">
                <td className="py-1">{idx + 1}</td>
                <td className="py-1">{it.item_name_snap}</td>
                <td className="py-1 text-right">{it.qty}</td>
                <td className="py-1 text-right">{it.mrp_snap}</td>
                <td className="py-1 text-right">{it.sold_inr}</td>
                <td className="py-1 text-right">{Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t-2 border-evergreen pt-2 flex justify-between font-bold text-forest">
          <span>Total ({bill.payment_mode})</span>
          <span>₹{Number(bill.total_amount).toFixed(2)}</span>
        </div>
        {bill.saved_amount > 0 && (
          <div className="text-xs text-fresh font-semibold mt-1 text-right">You Saved ₹{Number(bill.saved_amount).toFixed(2)}</div>
        )}

        <p className="text-center text-[10px] text-darkest/40 mt-4">Thank you for shopping with us!</p>
      </div>

      <div className="grid grid-cols-3 gap-2 print:hidden">
        <button onClick={handlePrint} className="bg-white border-2 border-amber/30 rounded-lg py-2.5 text-sm font-semibold text-forest">
          Print
        </button>
        <button onClick={handleDownload} className="bg-white border-2 border-amber/30 rounded-lg py-2.5 text-sm font-semibold text-forest">
          Download PDF
        </button>
        <button onClick={handleShareWhatsApp} className="bg-fresh text-cream rounded-lg py-2.5 text-sm font-semibold">
          WhatsApp
        </button>
      </div>
      {shareStatus && <p className="text-xs text-center text-darkest/60 print:hidden">{shareStatus}</p>}
    </div>
  );
}
