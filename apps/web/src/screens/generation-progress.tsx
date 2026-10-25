import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CircleDashed, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api';
import { Button, Notice, PageHeader } from '../components/ui';

export interface GenerationStatus {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  label: string;
  steps: Array<{ label: string; state: 'pending' | 'active' | 'done' | 'failed' }>;
  error: string | null;
  retrying: boolean;
  /** When the job will continue after a free AI allowance resets. */
  resumesAt?: string | null;
  seriesId: string | null;
  episodes: Array<{ id: string; number: number; title: string; status: string }>;
}

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

export function ProgressView({ data, onCancel, cancelling = false }: { data: GenerationStatus; onCancel: () => void; cancelling?: boolean }) {
  const done = TERMINAL.has(data.status);
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3" aria-label="Progress">
        {data.steps.map((s) => (
          <li key={s.label} aria-current={s.state === 'active' ? 'step' : undefined} className="flex items-center gap-3 text-[1.02rem]">
            {s.state === 'done' && <Check aria-hidden className="text-sage-ink" size={22} />}
            {s.state === 'active' && <LoaderCircle aria-hidden className="animate-spin text-accent-ink" size={22} />}
            {s.state === 'pending' && <CircleDashed aria-hidden className="text-muted" size={22} />}
            {s.state === 'failed' && <TriangleAlert aria-hidden className="text-danger" size={22} />}
            <span className={s.state === 'pending' ? 'text-muted' : 'text-ink'}>
              {s.label}
              <span className="sr-only"> — {s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : s.state === 'failed' ? 'failed' : 'not started'}</span>
            </span>
          </li>
        ))}
      </ol>

      {data.retrying && !done && (
        <Notice>
          {data.resumesAt
            ? `Today's free AI allowance is used up. Your podcast will continue automatically around ${new Date(data.resumesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
            : "A service was briefly unavailable, so we're retrying automatically."}
        </Notice>
      )}

      {data.episodes.some((e) => e.status === 'ready') && (
        <section aria-labelledby="ready-eps" className="flex flex-col gap-2">
          <h2 id="ready-eps" className="text-lg">
            Ready to listen
          </h2>
          <ul className="flex flex-col gap-2">
            {data.episodes
              .filter((e) => e.status === 'ready')
              .map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/series/${data.seriesId}#${e.id}`}
                    aria-label={`Listen to episode ${e.number}: ${e.title}`}
                    className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-surface-2"
                  >
                    {e.number}. {e.title}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      {(data.status === 'failed' || data.status === 'partial') && data.error && (
        <Notice tone="error" role="alert">
          {data.status === 'partial' ? 'Some episodes could not be finished. ' : ''}
          {data.error}
        </Notice>
      )}
      {data.status === 'cancelled' && <Notice>This series was cancelled.</Notice>}

      {data.status === 'succeeded' && data.seriesId && (
        <Link to={`/series/${data.seriesId}`} className="inline-flex min-h-14 items-center justify-center rounded-full bg-accent-strong px-5 text-[1.05rem] font-semibold text-on-accent shadow-card">
          Open your series
        </Link>
      )}

      {!done && (
        <>
          <p className="text-[0.95rem] text-muted">You can leave this page. We'll keep working, and your podcasts will appear in My Library.</p>
          <Button variant="ghost" onClick={onCancel} busy={cancelling}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

export function GenerationProgressScreen() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['generation', id],
    queryFn: () => api<GenerationStatus>(`/api/generations/${id}`),
    refetchInterval: (query) => (query.state.data && TERMINAL.has(query.state.data.status) ? false : 2500),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/generations/${id}/cancel`, { method: 'POST', body: '{}' }),
    onSuccess: () => q.refetch(),
  });
  return (
    <div>
      <PageHeader title={q.data?.label ?? 'Building your podcasts'} />
      {q.data ? (
        <ProgressView data={q.data} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />
      ) : q.isError ? (
        <Notice tone="error" role="alert">
          We couldn't find that request.
        </Notice>
      ) : (
        <p role="status" className="text-muted">
          Loading…
        </p>
      )}
    </div>
  );
}
