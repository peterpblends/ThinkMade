import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { Button, Card, Field, Notice, PageHeader } from '../../components/ui';

interface Models {
  stages: Array<{ stage: string; provider: string | null; model: string | null; custom?: boolean; recommended?: { provider: string; model: string } }>;
  providers: { llm: string[]; embed: string[] };
}

const STAGE_LABELS: Record<string, string> = {
  understand: 'Understanding the request', select_models: 'Mental model selection', research: 'Research', plan: 'Episode planning',
  script: 'Script writing', validate: 'Quality review', coach: 'Coach Me', vision: 'Photos and video', embed: 'Search embeddings',
};

function StageRow({ s, providers }: { s: Models['stages'][number]; providers: string[] }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  // A setting whose test failed, kept so the administrator can still save it on purpose.
  const [failed, setFailed] = useState<{ provider: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = s.recommended;
  const differs = !!rec && (s.provider !== rec.provider || s.model !== rec.model);
  const put = async (body: { provider: string; model: string; force?: boolean }) => {
    setBusy(true);
    setResult(null);
    try {
      await api(`/api/admin/models/${s.stage}`, { method: 'PUT', body: JSON.stringify(body) });
      setFailed(null);
      setResult({ tone: 'info', text: body.force ? 'Saved without a working test.' : 'Tested and saved.' });
      await qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { error?: string; message?: string } | null) : null;
      if (b?.error === 'test_failed') {
        setFailed({ provider: body.provider, model: body.model });
        setResult({ tone: 'error', text: `Not saved: this model didn't answer a test request. ${b.message ?? ''}` });
      } else setResult({ tone: 'error', text: 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await put({ provider: String(f.get('provider')), model: String(f.get('model')).trim() });
  };
  const reset = async () => {
    setBusy(true);
    setResult(null);
    try {
      await api(`/api/admin/models/${s.stage}/reset`, { method: 'POST', body: '{}' });
      setFailed(null);
      setResult({ tone: 'info', text: 'Back on the recommended model, with its automatic backups.' });
      await qc.invalidateQueries({ queryKey: ['admin', 'models'] });
    } catch {
      setResult({ tone: 'error', text: 'Could not reset.' });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const r = await api<{ ok: boolean; latencyMs: number; sample?: string; error?: string }>(`/api/admin/models/${s.stage}/test`, { method: 'POST', body: '{}' });
    setResult(r.ok ? { tone: 'info', text: `Working (${r.latencyMs} ms): ${r.sample}` } : { tone: 'error', text: `Not working: ${r.error}` });
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg">{STAGE_LABELS[s.stage] ?? s.stage}</h2>
      {rec && (
        <p className="text-sm text-muted">
          Recommended: <span className="font-semibold text-ink">{rec.provider}</span> · {rec.model}
          {differs ? ' (with automatic backups). This stage is set to something else.' : s.custom ? '' : ', with automatic backups.'}
        </p>
      )}
      <form onSubmit={save} className="flex flex-col gap-3" key={`${s.provider}|${s.model}`}>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Provider
          <select name="provider" defaultValue={s.provider ?? ''} className="min-h-12 rounded-xl border border-line bg-surface px-3">
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <Field label="Model" name="model" defaultValue={s.model ?? ''} required />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" busy={busy}>Test and save</Button>
          <Button type="button" variant="ghost" onClick={() => void test()}>Test</Button>
          {differs && (
            <Button type="button" variant="ghost" onClick={() => void reset()} disabled={busy}>
              Use recommended
            </Button>
          )}
        </div>
      </form>
      {result && <Notice tone={result.tone} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</Notice>}
      {failed && (
        <button type="button" onClick={() => void put({ ...failed, force: true })} className="self-start text-sm font-semibold text-danger underline-offset-4 hover:underline">
          Save anyway
        </button>
      )}
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
