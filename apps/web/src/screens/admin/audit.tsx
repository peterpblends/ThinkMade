import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui';

interface Entry { id: string; action: string; targetType: string; targetId: string | null; before: unknown; after: unknown; ip: string | null; createdAt: string; actor: string | null }

export function AdminAudit() {
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['admin', 'audit', action], queryFn: () => api<{ entries: Entry[] }>(`/api/admin/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" subtitle="Every administrative change, newest first." />
      <input aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value.trim())} placeholder="Filter by action, e.g. settings.update" className="min-h-11 rounded-full border border-line bg-surface px-4" />
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
        {q.data?.entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 p-3 text-sm">
            <p><span className="font-semibold">{e.action}</span> · {e.targetType}{e.targetId ? ` ${e.targetId}` : ''}</p>
            <p className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()} · {e.actor ?? 'system'}{e.ip ? ` · ${e.ip}` : ''}</p>
            {e.after != null && <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{JSON.stringify(e.after)}</pre>}
          </li>
        ))}
        {q.data?.entries.length === 0 && <li className="p-3 text-muted">No entries.</li>}
      </ul>
    </div>
  );
}
