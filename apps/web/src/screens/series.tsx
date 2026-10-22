import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { BookOpen, Lightbulb, MessageCircleQuestion, Pause, Play } from 'lucide-react';
import { usePlayer, type PlayableEpisode } from '../player/player-context';
import { DownloadButton } from '../offline/download-button';
import { startPositionFor } from '../offline/player-adapters';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import type { EpisodeSummary, SeriesDetail } from '../lib/types';
import { Notice, PageHeader } from '../components/ui';

export function toPlayable(ep: EpisodeSummary, seriesTitle: string): PlayableEpisode {
  return {
    id: ep.id,
    title: ep.title,
    seriesId: ep.seriesId,
    seriesTitle,
    number: ep.number,
    primaryModelName: ep.primaryModel?.name ?? null,
    audioUrl: ep.audioUrl ?? `/api/episodes/${ep.id}/audio`,
    durationSeconds: ep.durationSeconds,
  };
}

function PlayButton({ ep, seriesTitle, queue }: { ep: EpisodeSummary; seriesTitle: string; queue: PlayableEpisode[] }) {
  const player = usePlayer();
  const isCurrent = player.current?.id === ep.id;
  const playing = isCurrent && player.playing;
  return (
    <button
      type="button"
      onClick={async () => {
        if (isCurrent) return player.toggle();
        player.play(toPlayable(ep, seriesTitle), { queue, startAtMs: await startPositionFor(ep.id) });
      }}
      aria-label={`${playing ? 'Pause' : 'Play'} episode ${ep.number}: ${ep.title}`}
      className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-accent-strong px-5 font-semibold text-on-accent shadow-card"
    >
      {playing ? <Pause aria-hidden size={20} /> : <Play aria-hidden size={20} />} {playing ? 'Pause' : isCurrent ? 'Resume' : 'Play'}
    </button>
  );
}

function EpisodeCard({ ep, seriesTitle, queue }: { ep: EpisodeSummary; seriesTitle: string; queue: PlayableEpisode[] }) {
  return (
    <article id={ep.id} aria-labelledby={`${ep.id}-title`} className="scroll-mt-20 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
      <p className="text-sm font-semibold text-muted">
        Episode {ep.number}
        {ep.durationSeconds ? ` · ${formatDuration(ep.durationSeconds)}` : ''}
        {ep.hosts.length ? ` · with ${ep.hosts.map((h) => h.name).join(' and ')}` : ''}
      </p>
      <h2 id={`${ep.id}-title`} className="mt-1 text-xl">
        {ep.title}
      </h2>
      {ep.primaryModel && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1 text-sm font-semibold text-sage-ink">
          <Lightbulb aria-hidden size={16} /> {ep.primaryModel.name}
        </p>
      )}
      <p className="mt-3 text-[0.98rem]">{ep.description}</p>

      {ep.status === 'ready' && ep.audioUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <PlayButton ep={ep} seriesTitle={seriesTitle} queue={queue} />
          <Link to={`/coach/${ep.id}`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold">
            <MessageCircleQuestion aria-hidden size={18} /> Coach Me
          </Link>
          <span className="mt-4">
            <DownloadButton ep={toPlayable(ep, seriesTitle)} compact loadDetail={() => fetch(`/api/episodes/${ep.id}`, { credentials: 'same-origin' }).then((r) => r.json())} />
          </span>
        </div>
      ) : ep.status === 'failed' ? (
        <p className="mt-4 text-sm text-danger">This episode could not be finished.</p>
      ) : ep.status === 'needs_review' ? (
        <p className="mt-4 text-sm text-danger">This script did not pass our quality review, so it was not recorded. It is waiting for a person to review it.</p>
      ) : (
        <p role="status" className="mt-4 text-sm text-muted">
          Still being prepared…
        </p>
      )}

      <details className="mt-4 group">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent-ink">What you'll learn</summary>
        <div className="flex flex-col gap-4 pt-2 text-[0.96rem]">
          {ep.outcomes && (
            <dl className="grid gap-2">
              <div><dt className="font-semibold">Thinking</dt><dd className="text-muted">{ep.outcomes.thinking}</dd></div>
              <div><dt className="font-semibold">Seeing</dt><dd className="text-muted">{ep.outcomes.seeing}</dd></div>
              <div><dt className="font-semibold">Doing</dt><dd className="text-muted">{ep.outcomes.doing}</dd></div>
            </dl>
          )}
          {ep.keyTakeaways.length > 0 && (
            <div>
              <h3 className="text-base">Key takeaways</h3>
              <ul className="mt-1 list-disc pl-5">
                {ep.keyTakeaways.map((k) => <li key={k}>{k}</li>)}
              </ul>
            </div>
          )}
          {ep.examples.length > 0 && (
            <div>
              <h3 className="text-base">Examples</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {ep.examples.map((x) => (
                  <li key={x.title}>
                    <span className="font-semibold">{x.title}</span>{' '}
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{x.kind === 'real' ? 'Real case' : 'Hypothetical'}</span>
                    <span className="block text-muted">{x.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ep.supportingModels.length > 0 && (
            <p><span className="font-semibold">Related models:</span> {ep.supportingModels.map((m) => m.name).join(', ')}</p>
          )}
          {ep.sources.length === 0 && (
            <p className="text-muted">We could not verify a book for this mental model in library catalogues, so this episode does not cite one.</p>
          )}
          {ep.sources.length > 0 && (
            <div>
              <h3 className="flex items-center gap-1.5 text-base"><BookOpen aria-hidden size={16} /> Books and sources</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {ep.sources.map((s) => (
                  <li key={s.title}>
                    {s.url ? <a className="text-accent-ink underline underline-offset-4" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                    {s.verifiedVia && <span className="ml-1 text-xs text-muted">(verified via {s.verifiedVia === 'openlibrary' ? 'Open Library' : 'Google Books'})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

export function SeriesScreen() {
  const { id = '' } = useParams();
  const location = useLocation();
  const q = useQuery({
    queryKey: ['series', id],
    queryFn: () => api<SeriesDetail>(`/api/series/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 4000 : false),
  });
  useEffect(() => {
    if (q.data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [q.data, location.hash]);
  if (q.isError) return <Notice tone="error" role="alert">This series doesn't exist or isn't shared with you.</Notice>;
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  const s = q.data;
  return (
    <div>
      <PageHeader title={s.title} subtitle={s.description} />
      <div className="flex flex-col gap-5">
        {s.episodes.map((ep) => (
          <EpisodeCard key={ep.id} ep={ep} seriesTitle={s.title} queue={s.episodes.filter((e) => e.status === 'ready').map((e) => toPlayable(e, s.title))} />
        ))}
      </div>
    </div>
  );
}
