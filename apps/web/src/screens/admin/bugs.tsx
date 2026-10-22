import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui';

interface Bug { id: string; description: string; status: string; createdAt: string; diagnostics: Record<string, unknown>; hasScreenshot: boolean; reporter: string | null }
const STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
const LABEL: Record<string, string> = { new: 'New', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };

export function AdminBugs() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const bugs = useQuery({ queryKey: ['admin', 'bugs', status, q], queryFn: () => api<{ bugs: Bug[] }>(`/api/admin/bugs?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`) });
  const recurring = useQuery({ queryKey: ['admin', 'bugs', 'recurring'], queryFn: () => api<{ groups: Array<{ key: string; count: number; example: string }> }>('/api/admin/bugs/recurring') });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Bug reports" subtitle="Set where new reports are emailed in Defaults. Failed notification emails are shown in Overview." />
      {!!recurring.data?.groups.length && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg">Recurring problems</h2>
          <ul className="list-disc pl-5 text-sm">{recurring.data.groups.map((g) => <li key={g.key}><strong>{g.count}×</strong> {g.example}</li>)}</ul>
        </Card>
      )}
      <div className="flex gap-2">
        <input aria-label="Search reports" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4" />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-11 rounded-full border border-line bg-surface px-3">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
        </select>
      </div>
      <ul className="flex flex-col gap-3">
        {bugs.data?.bugs.map((b) => (
          <li key={b.id}>
            <Card className="flex flex-col gap-2">
              <p className="whitespace-pre-line">{b.description}</p>
              <p className="text-xs text-muted">{new Date(b.createdAt).toLocaleString()} · {b.reporter ?? 'Signed out'} · {Object.entries(b.diagnostics).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ')}</p>
              {b.hasScreenshot && <a className="text-sm font-semibold text-accent-ink underline" href={`/api/admin/bugs/${b.id}/screenshot`} target="_blank" rel="noopener noreferrer">View screenshot</a>}
              <label className="text-sm">Status{' '}
                <select value={b.status} onChange={async (e) => { await api(`/api/admin/bugs/${b.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }); await qc.invalidateQueries({ queryKey: ['admin', 'bugs'] }); }} className="ml-1 min-h-11 rounded-lg border border-line bg-surface px-2">
                  {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
              </label>
            </Card>
          </li>
        ))}
        {bugs.data?.bugs.length === 0 && <p className="text-muted">No reports.</p>}
      </ul>
    </div>
  );
}
