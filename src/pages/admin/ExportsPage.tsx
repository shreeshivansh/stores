import { useState } from 'react';
import { exportAdminWorkbook } from '@/lib/exportXlsxAdmin';

type ExportState = 'idle' | 'working' | 'done' | 'error';

const SHEETS = [
  { label: 'Product Analysis (PA)', desc: 'Full margin analysis incl. cost per unit — admin-only data.' },
  { label: 'Stock Register', desc: 'Opening / Purchased / Sold / Closing / Variance per product.' },
  { label: 'Monthly Summary', desc: 'Sales, purchases, expenses, and net profit aggregated by month.' },
  { label: 'Sales Register', desc: 'Every sale line item across all staff accounts (up to 5,000 rows).' },
  { label: 'Purchase Register', desc: 'Every purchase line item, flattened one row per item.' },
  { label: 'Expense Register', desc: 'All recorded expenses.' },
  { label: 'Daily Accounts', desc: 'Cash reconciliation rows.' },
];

export default function ExportsPage() {
  const [state, setState] = useState<ExportState>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setState('working');
    setError(null);
    try {
      const name = await exportAdminWorkbook();
      setFileName(name);
      setState('done');
    } catch (e: any) {
      setError(e.message ?? 'Export failed');
      setState('error');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Exports</h1>
        <p className="text-sm text-darkest/60">
          Builds a single multi-sheet .xlsx workbook from live data — never a stale cached snapshot. Every sheet here is queried
          through an admin-gated RPC or an admin-only RLS policy, so this button produces nothing for a client-role account.
        </p>
      </div>

      <div className="bg-white rounded-xl2 border border-amber/20 shadow-sm p-5 space-y-4">
        <div>
          <h2 className="font-bold text-forest text-sm mb-2">Included in the Admin Workbook</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {SHEETS.map((s) => (
              <div key={s.label} className="border border-amber/20 rounded-lg p-3 bg-cream/40">
                <div className="text-sm font-semibold text-darkest">{s.label}</div>
                <div className="text-xs text-darkest/60 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={state === 'working'}
          className="bg-gold text-darkest font-bold px-5 py-2.5 rounded-lg hover:bg-honey transition-colors disabled:opacity-50"
        >
          {state === 'working' ? 'Building workbook…' : 'Export Full Admin Workbook (.xlsx)'}
        </button>

        {state === 'done' && fileName && (
          <div className="bg-fresh/10 border border-fresh/30 text-fresh text-sm rounded-lg px-3 py-2">
            Downloaded <span className="font-semibold">{fileName}</span>. This export was also recorded in the Audit Logs.
          </div>
        )}
        {state === 'error' && error && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2">{error}</div>}
      </div>

      <div className="bg-white rounded-xl2 border border-dashed border-amber/30 p-4 text-xs text-darkest/60">
        Individual staff can export their own Sales Register from the client Sales screen — that export is scoped to their own
        rows only (RLS-enforced) and is a separate, narrower file from this admin workbook.
      </div>
    </div>
  );
}
