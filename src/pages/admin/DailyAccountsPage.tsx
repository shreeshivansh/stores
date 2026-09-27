import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { DailyAccountRow } from '@/types';

export default function DailyAccountsPage() {
  const [rows, setRows] = useState<DailyAccountRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('v_daily_accounts_extended')
      .select('*')
      .order('account_date', { ascending: false })
      .limit(90)
      .then(({ data }) => setRows((data as DailyAccountRow[]) ?? []))
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Daily Accounts</h1>
        <p className="text-sm text-darkest/60">Day Total = Opening + Morning + Evening cash-in, matching the workbook formula.</p>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { header: 'Date', accessor: (r) => r.account_date },
          { header: 'Opening', accessor: (r) => `₹${r.opening_cash}`, align: 'right' },
          { header: 'Morning', accessor: (r) => `₹${r.cash_in_morning}`, align: 'right' },
          { header: 'Evening', accessor: (r) => `₹${r.cash_in_evening}`, align: 'right' },
          { header: 'UPI In', accessor: (r) => `₹${r.upi_in}`, align: 'right' },
          { header: 'Cash Out', accessor: (r) => `₹${r.cash_out}`, align: 'right' },
          { header: 'Closing', accessor: (r) => `₹${r.closing_cash}`, align: 'right' },
          { header: 'Day Total', accessor: (r) => `₹${r.day_total}`, align: 'right' },
          {
            header: 'Flag',
            accessor: (r) =>
              r.below_3000_flag ? (
                <span className="text-xs font-bold text-packred">Below ₹3000</span>
              ) : r.between_1500_2500_flag ? (
                <span className="text-xs font-bold text-amber">₹1500–2500</span>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
