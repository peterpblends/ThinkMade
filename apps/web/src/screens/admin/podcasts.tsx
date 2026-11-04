import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, LoaderCircle, Pause, Play, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, type ApiError } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import type { SeriesDetail } from '../../lib/types';
import { usePlayer } from '../../player/player-context';
import { Button, Card, Notice, PageHeader } from '../../components/ui';
import { ShowArt } from '../../components/show-art';
import { toPlayable } from '../series';

export interface AdminPodcast {
  id: string;
  title: string;
  status: string;
  visibility: string;
  createdAt: string;
  owner: { id: string; email: string };
  episodeCount: number;
  readyCount: number;
  job: { id: string; status: string; error: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = { ready: 'Ready', generating: 'Being made', partial: 'Partly made', failed: 'Errored', pending: 'Waiting', cancelled: 'Cancelled' };
const STATUS_TONE: Record<string, string> = { ready: 'bg-sage-soft text-sage-ink', generating: 'bg-surface-2 text-ink', partial: 'bg-accent/15 text-accent-ink', failed: 'bg-danger/10 text-danger' };

const message = (err: unknown, fallback: string) => ((err as ApiError).body as { message?: string } | null)?.message ?? fallback;

/** Admin: every listener's podcasts, to listen to, regenerate or delete. */
export function AdminPodcasts() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'podcasts', q, status],
    queryFn: () => api<{ podcasts: AdminPodcast[]; more: boolean }>(`/api/admin/podcasts?${new URLSearchParams({ q, status })}`),
    // Keep up while podcasts are being made or regenerated.
    refetchInterval: (query) => (query.state.data?.podcasts.some((p) => p.status === 'generating') ? 5000 : false),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Podcasts" subtitle="Every listener's podcasts. Listen to any of them, make them again, or delete them. Regenerating and deleting are recorded in the audit log." />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <label htmlFor="admin-podcast-search" className="sr-only">
            Search by title or owner
          </label>
          <input
            id="admin-podcast-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or owner's email"
            className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-ink placeholder:text-muted"
          />
        </div>
        <label htmlFor="admin-podcast-status" className="sr-only">
          Status
        </label>
        <select id="admin-podcast-status" value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-12 rounded-full border border-line bg-surface px-4 text-sm">
          <option value="">All statuses</option>
          {['ready', 'generating', 'partial', 'failed', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {note && (
        <Notice tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </Notice>
      )}
      {list.isLoading && <p role="status" className="text-muted">Loading…</p>}
      {list.data?.podcasts.length === 0 && <p className="text-muted">No podcasts match.</p>}
      <ul className="flex flex-col gap-3">
        {list.data?.podcasts.map((p) => (
          <PodcastRow key={p.id} p={p} onNote={setNote} />
        ))}
      </ul>
      {list.data?.more && <p className="text-sm text-muted">Showing the newest 50. Search to narrow it down.</p>}
    </div>
  );
}

function PodcastRow({ p, onNote }: { p: AdminPodcast; onNote: (n: { tone: 'error' | 'info'; text: string } | null) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'podcasts'] }), qc.invalidateQueries({ queryKey: ['series', p.id] })]);
  const regenerate = useMutation({
    mutationFn: (episodeIds?: string[]) => api(`/api/admin/podcasts/${p.id}/regenerate`, { method: 'POST', body: JSON.stringify(episodeIds ? { episodeIds } : {}) }),
    onMutate: () => onNote(null),
    onSuccess: async (_d, episodeIds) => {
      onNote({ tone: 'info', text: `“${p.title}”: ${episodeIds ? 'the episode is' : 'its episodes are'} being made again. The current audio stays until the new one is ready.` });
      await refresh();
    },
    onError: (err) => onNote({ tone: 'error', text: message(err, 'Could not regenerate this podcast.') }),
  });
  const remove = useMutation({
    mutationFn: (reason: string) => api(`/api/admin/podcasts/${p.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    onMutate: () => onNote(null),
    onSuccess: async () => {
      onNote({ tone: 'info', text: `“${p.title}” was deleted.` });
      await refresh();
    },
    onError: (err) => onNote({ tone: 'error', text: message(err, 'Could not delete this podcast.') }),
  });
  const busy = p.status === 'generating' || regenerate.isPending || remove.isPending;
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ShowArt seriesId={p.id} title={p.title} decorative className="h-14 w-14 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Link to={`/series/${p.id}`} className="font-serif text-lg font-semibold leading-snug underline-offset-4 hover:underline">
              {p.title}
            </Link>
            <p className="truncate text-sm text-muted">
              {p.owner.email} · {new Date(p.createdAt).toLocaleDateString()} · {p.visibility === 'public' ? 'Public' : 'Private'}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[p.status] ?? 'bg-surface-2 text-ink'}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
              <span className="text-muted">
                {p.readyCount} of {p.episodeCount} episode{p.episodeCount === 1 ? '' : 's'} ready
              </span>
            </p>
            {p.status === 'failed' && p.job?.error && <p className="mt-1 text-sm text-danger [overflow-wrap:anywhere]">{p.job.error}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11 text-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp aria-hidden size={16} /> : <ChevronDown aria-hidden size={16} />} Episodes
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 text-sm"
            disabled={busy}
            busy={regenerate.isPending && !regenerate.variables}
            onClick={() => {
              if (window.confirm(`Make every episode of “${p.title}” again? The scripts are rewritten and recorded again for its owner.`)) regenerate.mutate(undefined);
            }}
          >
            <RefreshCw aria-hidden size={16} /> Regenerate
          </Button>
          <Button
            variant="danger"
            className="min-h-11 text-sm"
            disabled={remove.isPending}
            onClick={() => {
              const reason = window.prompt(`Delete “${p.title}” (${p.owner.email}) for good? Give a short reason.`);
              if (reason && reason.trim().length >= 3) remove.mutate(reason.trim());
            }}
          >
            <Trash2 aria-hidden size={16} /> Delete
          </Button>
        </div>
        {open && <Episodes seriesId={p.id} title={p.title} disabled={busy} onRegenerate={(id) => regenerate.mutate([id])} regenerating={regenerate.isPending ? regenerate.variables : undefined} />}
      </Card>
    </li>
  );
}

function Episodes({ seriesId, title, disabled, onRegenerate, regenerating }: { seriesId: string; title: string; disabled: boolean; onRegenerate: (episodeId: string) => void; regenerating: string[] | undefined }) {
  const player = usePlayer();
  const q = useQuery({ queryKey: ['series', seriesId], queryFn: () => api<SeriesDetail>(`/api/series/${seriesId}`) });
  if (q.isLoading) return <p role="status" className="text-sm text-muted">Loading episodes…</p>;
  if (!q.data) return <p className="text-sm text-danger">Could not load the episodes.</p>;
  const ready = q.data.episodes.filter((e) => e.status === 'ready');
  const queue = ready.map((e) => toPlayable(e, q.data!.title));
  if (!q.data.episodes.length) return <p className="text-sm text-muted">No episodes yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-line rounded-xl border border-line">
      {q.data.episodes.map((e) => {
        const playing = player.current?.id === e.id && player.playing;
        return (
          <li key={e.id} className="flex items-center gap-3 px-3 py-2">
            <button
              type="button"
              disabled={e.status !== 'ready'}
              onClick={() => (player.current?.id === e.id ? player.toggle() : player.play(toPlayable(e, title), { queue }))}
              aria-label={playing ? `Pause episode ${e.number}` : `Play episode ${e.number}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-strong text-on-accent disabled:opacity-40"
            >
              {playing ? <Pause aria-hidden size={18} /> : <Play aria-hidden size={18} />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-semibold">
                {e.number}. {e.title}
              </p>
              <p className="text-xs text-muted">{e.status === 'ready' ? formatDuration(e.durationSeconds ?? 0) : (STATUS_LABEL[e.status] ?? e.status)}</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (window.confirm(`Make episode ${e.number}, “${e.title}”, again?`)) onRegenerate(e.id);
              }}
              aria-label={`Regenerate episode ${e.number}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink hover:bg-surface-2 disabled:opacity-40"
            >
              {regenerating?.includes(e.id) ? <LoaderCircle aria-hidden size={16} className="animate-spin" /> : <RefreshCw aria-hidden size={16} />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
