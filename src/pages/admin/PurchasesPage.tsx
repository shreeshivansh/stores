import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';

interface PurchaseRow {
  id: string;
  purchase_date: string;
  supplier: string;
  purchase_items: { item_name_snap: string; qty: number; amount: number; cost_per_unit: number; paid_credit: string }[];
}

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    supabase
      .from('purchases')
      .select('id, purchase_date, supplier, purchase_items(item_name_snap, qty, amount, cost_per_unit, paid_credit)')
      .order('purchase_date', { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data as PurchaseRow[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }

  const flat = rows.flatMap((p) => p.purchase_items.map((item) => ({ ...item, purchase_date: p.purchase_date, supplier: p.supplier, id: p.id + item.item_name_snap })));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Purchase Register</h1>
        <p className="text-sm text-darkest/60">Cost per unit = Amount ÷ Qty, stored as a generated column.</p>
      </div>

      <DataTable
        loading={loading}
        rows={flat}
        rowKey={(r) => r.id}
        columns={[
          { header: 'Date', accessor: (r) => r.purchase_date },
          { header: 'Supplier', accessor: (r) => r.supplier },
          { header: 'Item', accessor: (r) => r.item_name_snap },
          { header: 'Qty', accessor: (r) => r.qty, align: 'right' },
          { header: 'Amount', accessor: (r) => `₹${r.amount}`, align: 'right' },
          { header: 'Cost/Unit', accessor: (r) => `₹${Number(r.cost_per_unit).toFixed(2)}`, align: 'right' },
          { header: 'Paid/Credit', accessor: (r) => r.paid_credit },
        ]}
      />
    </div>
  );
}
