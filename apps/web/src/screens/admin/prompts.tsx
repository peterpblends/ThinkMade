import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Notice, PageHeader } from '../../components/ui';

const STAGES = ['understand', 'select_models', 'research', 'plan', 'script', 'validate', 'vision', 'coach'] as const;

interface StagePrompts {
  defaultTask: string;
  active: number | null;
  versions: Array<{ version: number; task: string; active: boolean; note: string | null; createdAt: string }>;
}

export function AdminPrompts() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<(typeof STAGES)[number]>('script');
  const q = useQuery({ queryKey: ['admin', 'prompts', stage], queryFn: () => api<StagePrompts>(`/api/admin/prompts/${stage}`) });
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [sample, setSample] = useState('{"question": "How can I become a better leader?"}');
  const [result, setResult] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'prompts', stage] });
  const current = q.data ? (q.data.versions.find((v) => v.active)?.task ?? q.data.defaultTask) : '';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Prompts" subtitle="Each stage uses its built-in instructions unless a version is active. Drafts can be tested on sample input before activating. Activating an older version rolls back." />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Stage
        <select value={stage} onChange={(e) => { setStage(e.target.value as (typeof STAGES)[number]); setDraft(''); setResult(null); }} className="min-h-12 rounded-xl border border-line bg-surface px-3">
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {q.data && (
        <>
          <Card className="flex flex-col gap-2">
            <h2 className="text-lg">In use: {q.data.active ? `version ${q.data.active}` : 'built-in'}</h2>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs">{current}</pre>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg">New draft</h2>
            <label htmlFor="draft" className="sr-only">Instructions</label>
            <textarea id="draft" rows={10} value={draft || current} onChange={(e) => setDraft(e.target.value)} className="rounded-xl border border-line bg-surface p-3 text-sm" />
            <label htmlFor="note" className="text-sm font-medium">Change note</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3" />
            <Button
              variant="secondary"
              onClick={async () => {
                await api(`/api/admin/prompts/${stage}`, { method: 'POST', body: JSON.stringify({ task: draft || current, note: note || undefined }) });
                setResult({ tone: 'info', text: 'Draft saved. Test it below, then activate.' });
                setDraft('');
                await refresh();
              }}
            >
              Save draft
            </Button>
            <label htmlFor="sample" className="text-sm font-medium">Sample input for tests (JSON)</label>
            <textarea id="sample" rows={3} value={sample} onChange={(e) => setSample(e.target.value)} className="rounded-xl border border-line bg-surface p-3 font-mono text-xs" />
          </Card>
          {result && <Notice tone={result.tone} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</Notice>}
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg">Versions</h2>
            {q.data.versions.length === 0 && <p className="text-muted">No versions yet.</p>}
            <ul className="flex flex-col divide-y divide-line">
              {q.data.versions.map((v) => (
                <li key={v.version} className="flex flex-col gap-2 py-3">
                  <p className="font-semibold">Version {v.version} {v.active && <span className="ml-1 rounded-full bg-sage-soft px-2 py-0.5 text-xs text-sage-ink">Active</span>}</p>
                  {v.note && <p className="text-sm text-muted">{v.note}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        let input: unknown;
                        try { input = JSON.parse(sample); } catch { return setResult({ tone: 'error', text: 'The sample input is not valid JSON.' }); }
                        setResult({ tone: 'info', text: 'Testing…' });
                        const r = await api<{ valid: boolean; output: string | null; issues?: string }>(`/api/admin/prompts/${stage}/${v.version}/test`, { method: 'POST', body: JSON.stringify({ input }) });
                        setResult(r.valid ? { tone: 'info', text: `Valid output:\n${r.output}` } : { tone: 'error', text: `Did not produce valid output: ${r.issues ?? ''}` });
                      }}
                    >
                      Test
                    </Button>
                    {!v.active && (
                      <Button variant="secondary" onClick={async () => { await api(`/api/admin/prompts/${stage}/${v.version}/activate`, { method: 'POST', body: '{}' }); await refresh(); }}>
                        Activate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {q.data.active && (
              <Button variant="ghost" onClick={async () => { await api(`/api/admin/prompts/${stage}/reset`, { method: 'POST', body: '{}' }); await refresh(); }}>
                Return to built-in instructions
              </Button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
