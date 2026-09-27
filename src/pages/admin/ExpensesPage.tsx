import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { Expense } from '@/types';

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .then(({ data }) => setRows((data as Expense[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-forest">Expense Register</h1>
          <p className="text-sm text-darkest/60">One-time and recurring store expenses.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-darkest/50">Total</div>
          <div className="text-lg font-extrabold text-packred">₹{total.toFixed(2)}</div>
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { header: 'Date', accessor: (r) => r.expense_date ?? '—' },
          { header: 'Type', accessor: (r) => r.expense_type },
          { header: 'Amount', accessor: (r) => `₹${r.amount}`, align: 'right' },
          { header: 'Mode', accessor: (r) => r.mode ?? '—' },
          { header: 'Notes', accessor: (r) => r.notes ?? '—' },
        ]}
      />
    </div>
  );
}
