import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import DataTable from '@/components/admin/DataTable';
import type { AuditLogRow } from '@/types';

const PAGE_SIZE = 50;

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED'>('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter, successFilter]);

  function load() {
    setLoading(true);
    // audit_logs_admin_select is the ONLY select policy on this table — a
    // client-role account gets zero rows here, not a filtered subset, since
    // there is no client-facing policy on audit_logs at all (see 0003).
    let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('event_time', { ascending: false });
    if (actionFilter.trim()) query = query.ilike('action', `%${actionFilter.trim()}%`);
    if (successFilter === 'SUCCESS') query = query.eq('success', true);
    if (successFilter === 'FAILED') query = query.eq('success', false);
    query
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, count }) => {
        setRows((data as AuditLogRow[]) ?? []);
        setCount(count ?? 0);
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-forest">Audit Logs</h1>
        <p className="text-sm text-darkest/60">
          Append-only. Every row is written server-side by a SECURITY DEFINER function — nothing here can be edited or deleted, even by an admin.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={actionFilter}
          onChange={(e) => {
            setPage(0);
            setActionFilter(e.target.value);
          }}
          placeholder="Filter by action (e.g. sale.create)…"
          className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <select
          value={successFilter}
          onChange={(e) => {
            setPage(0);
            setSuccessFilter(e.target.value as typeof successFilter);
          }}
          className="border border-amber/30 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="ALL">All Outcomes</option>
          <option value="SUCCESS">Success only</option>
          <option value="FAILED">Failed only</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(r) => String(r.id)}
        emptyMessage="No audit events match this filter."
        columns={[
          { header: 'Time', accessor: (r) => new Date(r.event_time).toLocaleString('en-IN') },
          { header: 'Actor Role', accessor: (r) => r.actor_role ?? '—' },
          { header: 'Action', accessor: (r) => <span className="font-mono text-xs">{r.action}</span> },
          { header: 'Table', accessor: (r) => r.entity_table ?? '—' },
          { header: 'Entity ID', accessor: (r) => <span className="text-xs">{r.entity_id ? r.entity_id.slice(0, 8) + '…' : '—'}</span> },
          {
            header: 'Outcome',
            accessor: (r) =>
              r.success ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-fresh/10 text-fresh">OK</span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-packred/10 text-packred" title={r.error_message ?? ''}>
                  Failed
                </span>
              ),
          },
          {
            header: 'Details',
            accessor: (r) => (
              <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-xs text-evergreen font-semibold hover:underline">
                {expandedId === r.id ? 'Hide' : 'View'}
              </button>
            ),
          },
        ]}
      />

      {expandedId != null &&
        (() => {
          const row = rows.find((r) => r.id === expandedId);
          if (!row) return null;
          return (
            <div className="bg-white rounded-xl2 border border-amber/20 p-4 shadow-sm text-xs space-y-2">
              {row.error_message && <div className="text-packred font-semibold">Error: {row.error_message}</div>}
              <div>
                <div className="font-semibold text-darkest/70 mb-1">Before</div>
                <pre className="bg-cream rounded-lg p-2 overflow-x-auto">{JSON.stringify(row.before_value, null, 2) ?? 'null'}</pre>
              </div>
              <div>
                <div className="font-semibold text-darkest/70 mb-1">After</div>
                <pre className="bg-cream rounded-lg p-2 overflow-x-auto">{JSON.stringify(row.after_value, null, 2) ?? 'null'}</pre>
              </div>
            </div>
          );
        })()}

      <div className="flex justify-between items-center pt-2">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="text-sm font-semibold text-evergreen disabled:opacity-30">
          ← Prev
        </button>
        <span className="text-xs text-darkest/50">
          Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))} · {count} events
        </span>
        <button
          disabled={(page + 1) * PAGE_SIZE >= count}
          onClick={() => setPage((p) => p + 1)}
          className="text-sm font-semibold text-evergreen disabled:opacity-30"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
