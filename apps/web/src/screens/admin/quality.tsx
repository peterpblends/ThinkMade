import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Notice, PageHeader } from '../../components/ui';

interface Held { id: string; title: string; scores: Record<string, number> | null; notes: string[]; reviews: number; script: string }
interface Recent { id: string; title: string; seriesTitle: string; scores: Record<string, number> | null; humanReviews: number }

function HeldItem({ h }: { h: Held }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'reject') => {
    if (note.trim().length < 3) return setMsg('Add a short note explaining your decision.');
    await api(`/api/admin/quality/${h.id}`, { method: 'POST', body: JSON.stringify({ decision, note }) });
    await qc.invalidateQueries({ queryKey: ['admin', 'quality'] });
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg">{h.title}</h2>
      <p className="text-sm text-muted">{h.reviews} automatic review{h.reviews === 1 ? '' : 's'}</p>
      {h.scores && <p className="text-sm">{Object.entries(h.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
      <ul className="list-disc pl-5 text-sm">{h.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <details><summary className="cursor-pointer font-semibold text-accent-ink">Read the script</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{h.script}</pre></details>
      <label htmlFor={`note-${h.id}`} className="text-sm font-medium">Your note</label>
      <textarea id={`note-${h.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl border border-line bg-surface p-2" />
      <div className="flex gap-2">
        <Button onClick={() => void decide('approve')}>Approve and record</Button>
        <Button variant="danger" onClick={() => void decide('reject')}>Reject</Button>
      </div>
      {msg && <Notice tone="error" role="alert">{msg}</Notice>}
    </Card>
  );
}

function RecentItem({ r }: { r: Recent }) {
  const [score, setScore] = useState(4);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  return (
    <li className="flex flex-col gap-2 py-3">
      <p className="font-semibold">{r.title} <span className="font-normal text-muted">· {r.seriesTitle}</span></p>
      {r.scores && <p className="text-xs text-muted">Auto: {Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
      {done ? <p role="status" className="text-sm text-sage-ink">Review saved.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">Score <select value={score} onChange={(e) => setScore(Number(e.target.value))} className="ml-1 min-h-11 rounded-lg border border-line bg-surface px-2">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
          <input aria-label="Review note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-2" />
          <Button variant="secondary" onClick={async () => { await api(`/api/admin/quality/${r.id}/review`, { method: 'POST', body: JSON.stringify({ score, note }) }); setDone(true); }}>Save review</Button>
        </div>
      )}
    </li>
  );
}

export function AdminQuality() {
  const held = useQuery({ queryKey: ['admin', 'quality'], queryFn: () => api<{ held: Held[] }>('/api/admin/quality') });
  const recent = useQuery({ queryKey: ['admin', 'quality', 'recent'], queryFn: () => api<{ recent: Recent[] }>('/api/admin/quality?scope=recent') });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quality review" subtitle="Scripts that failed automatic review are held here and never recorded until a person approves them. Spot-check published episodes below." />
      {held.data?.held.length === 0 && <p className="text-muted">Nothing is waiting for review.</p>}
      {held.data?.held.map((h) => <HeldItem key={h.id} h={h} />)}
      <Card className="flex flex-col gap-1">
        <h2 className="text-lg">Spot-check recent episodes</h2>
        <ul className="divide-y divide-line">{recent.data?.recent.map((r) => <RecentItem key={r.id} r={r} />)}</ul>
      </Card>
    </div>
  );
}
