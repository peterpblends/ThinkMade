import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Field, Notice, PageHeader } from '../../components/ui';

interface Models {
  stages: Array<{ stage: string; provider: string | null; model: string | null }>;
  providers: { llm: string[]; embed: string[] };
}

const STAGE_LABELS: Record<string, string> = {
  understand: 'Understanding the request', select_models: 'Mental model selection', research: 'Research', plan: 'Episode planning',
  script: 'Script writing', validate: 'Quality review', coach: 'Coach Me', vision: 'Photos and video', embed: 'Search embeddings',
};

function StageRow({ s, providers }: { s: Models['stages'][number]; providers: string[] }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/api/admin/models/${s.stage}`, { method: 'PUT', body: JSON.stringify({ provider: f.get('provider'), model: String(f.get('model')).trim() }) });
      setResult({ tone: 'info', text: 'Saved.' });
      await qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    } catch {
      setResult({ tone: 'error', text: 'Could not save.' });
    }
  };
  const test = async () => {
    const r = await api<{ ok: boolean; latencyMs: number; sample?: string; error?: string }>(`/api/admin/models/${s.stage}/test`, { method: 'POST', body: '{}' });
    setResult(r.ok ? { tone: 'info', text: `Working (${r.latencyMs} ms): ${r.sample}` } : { tone: 'error', text: `Not working: ${r.error}` });
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg">{STAGE_LABELS[s.stage] ?? s.stage}</h2>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Provider
          <select name="provider" defaultValue={s.provider ?? ''} className="min-h-12 rounded-xl border border-line bg-surface px-3">
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <Field label="Model" name="model" defaultValue={s.model ?? ''} required />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">Save</Button>
          <Button type="button" variant="ghost" onClick={() => void test()}>Test</Button>
        </div>
      </form>
      {result && <Notice tone={result.tone} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</Notice>}
    </Card>
  );
}

export function AdminModels() {
  const q = useQuery({ queryKey: ['admin', 'models'], queryFn: () => api<Models>('/api/admin/models') });
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI models" subtitle="Choose the model for each stage. API keys are set as server environment variables, never here. Use Test before relying on a change." />
      {q.data.stages.map((s) => <StageRow key={s.stage} s={s} providers={s.stage === 'embed' ? q.data.providers.embed : q.data.providers.llm} />)}
    </div>
  );
}
