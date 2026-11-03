import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { BookOpen, Lightbulb, LoaderCircle, MessageCircleQuestion, Pause, Play, Plus, RefreshCw, Share2 } from 'lucide-react';
import { usePlayer, type PlayableEpisode } from '../player/player-context';
import { DownloadButton } from '../offline/download-button';
import { startPositionFor } from '../offline/player-adapters';
import { api, type ApiError } from '../lib/api';
import { formatDuration } from '../lib/format';
import type { EpisodeSummary, SeriesDetail } from '../lib/types';
import { Button, Card, Notice, PageHeader } from '../components/ui';
import { SeriesOwnerActions, shareLink } from './series-actions';
import { useSession } from '../lib/auth-client';
import { useNavigate } from 'react-router';
import { useFeatures, usePublicSettings } from '../lib/features';
import { LANGUAGES, languageInfo } from '@thinkmade/shared';
import { ShowArt } from '../components/show-art';
import { ArtworkPicker } from '../components/artwork-picker';
import { publicSlugFor, SHARE_NOTE, shareTarget } from '../lib/share';

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

function EpisodeCard({ ep, seriesTitle, queue, onShare, language }: { ep: EpisodeSummary; seriesTitle: string; queue: PlayableEpisode[]; onShare?: ((ep: EpisodeSummary) => void) | undefined; language?: string | undefined }) {
  const features = useFeatures();
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
      {language && ep.audioLanguage && ep.audioLanguage !== language && ep.status === 'ready' && (
        <p className="mt-2 text-sm text-muted">
          {ep.languageStatus === 'failed'
            ? `Its ${languageInfo(language).name} audio couldn't be made, so it plays in ${languageInfo(ep.audioLanguage).name}.`
            : `Plays in ${languageInfo(ep.audioLanguage).name} until its ${languageInfo(language).name} audio is ready.`}
        </p>
      )}

      {ep.status === 'ready' && ep.audioUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <PlayButton ep={ep} seriesTitle={seriesTitle} queue={queue} />
          {features.coach && (
            <Link to={`/coach/${ep.id}`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold">
              <MessageCircleQuestion aria-hidden size={18} /> Coach Me
            </Link>
          )}
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(ep)}
              aria-label={`Share episode ${ep.number}: ${ep.title}`}
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold"
            >
              <Share2 aria-hidden size={18} /> Share
            </button>
          )}
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

function PublicActions({ s }: { s: SeriesDetail }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={async () => {
          if (!user) return navigate(`/sign-in?next=${encodeURIComponent(`/p/${s.publicSlug}`)}`);
          await api(`/api/library/${s.id}`, { method: 'PUT', body: '{}' });
          setNote('Saved to My Library.');
        }}
      >
        Save to My Library
      </Button>
      <Button
        variant="ghost"
        onClick={async () => {
          const r = await shareLink(s.title, s.publicSlug!);
          setNote(r === 'copied' ? 'Link copied.' : r === 'shared' ? 'Shared.' : 'Could not share the link.');
        }}
      >
        Share
      </Button>
      {note && <p role="status" className="w-full text-sm text-muted">{note}</p>}
    </div>
  );
}

export function PublicSeriesScreen() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['public', slug], queryFn: () => api<SeriesDetail>(`/api/public/${slug}`) });
  if (q.isError) return <Notice tone="error" role="alert">This podcast is not shared, or the link has changed.</Notice>;
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  return <SeriesView s={q.data} />;
}

/** A shared episode's own page: that episode, with a way to the rest of the podcast. */
export function PublicEpisodeScreen() {
  const { slug = '', number = '' } = useParams();
  const q = useQuery({ queryKey: ['public', slug], queryFn: () => api<SeriesDetail>(`/api/public/${slug}`) });
  if (q.isError) return <Notice tone="error" role="alert">This episode is not shared, or the link has changed.</Notice>;
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  const s = q.data;
  const ep = s.episodes.find((e) => e.number === Number(number));
  if (!ep) {
    return (
      <Notice tone="error" role="alert">
        This episode isn't available. <Link className="font-semibold underline" to={`/p/${slug}`}>See the whole podcast</Link>
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <ShowArt seriesId={s.id} title={s.title} art={s.artwork?.selected} decorative className="w-24 rounded-2xl shadow-card sm:w-28" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">From the podcast</p>
          <Link to={`/p/${slug}`} className="font-serif text-xl font-semibold leading-snug underline-offset-4 hover:underline">
            {s.title}
          </Link>
        </div>
      </div>
      <EpisodeCard ep={ep} seriesTitle={s.title} queue={[toPlayable(ep, s.title)]} />
      <Link to={`/p/${slug}`} className="self-start font-semibold text-accent-ink underline underline-offset-4">
        All {s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'} of {s.title}
      </Link>
    </div>
  );
}

export function SeriesScreen() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['series', id],
    queryFn: () => api<SeriesDetail>(`/api/series/${id}`),
    // Refresh while it is being made, or while a new language's audio is being recorded.
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' || query.state.data?.activeGenerationId ? 4000 : query.state.data?.episodes.some((e) => e.languageStatus === 'voicing') ? 15_000 : false,
  });
  if (q.isError) return <Notice tone="error" role="alert">This series doesn't exist or isn't shared with you.</Notice>;
  if (!q.data) return <p role="status" className="text-muted">Loading…</p>;
  return <SeriesView s={q.data} />;
}

/** Where a reviewer removed an episode: nothing of it is shown, but the owner can ask for a new one. */
function RemovedEpisode({ seriesId, ep, disabled }: { seriesId: string; ep: { id: string; number: number }; disabled: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const replace = useMutation({
    mutationFn: () => api<{ id: string }>(`/api/series/${seriesId}/episodes/${ep.id}/replace`, { method: 'POST', body: '{}' }),
    onSuccess: (r) => navigate(`/generations/${r.id}`),
    onError: (err) => setError(((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not start a replacement. Please try again.'),
  });
  return (
    <section aria-label={`Episode ${ep.number} was removed`} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-line p-5">
      <p className="text-sm font-semibold text-muted">Episode {ep.number}</p>
      <p className="text-[0.98rem]">This episode didn't pass our review, so we removed it.</p>
      <div>
        <Button variant="secondary" onClick={() => replace.mutate()} busy={replace.isPending} disabled={disabled}>
          <RefreshCw aria-hidden size={18} /> Create a replacement
        </Button>
      </div>
      {error && <Notice tone="error" role="alert">{error}</Notice>}
    </section>
  );
}

/** More episodes at the end of the series, up to the most a series may have. */
function AddEpisodes({ s }: { s: SeriesDetail }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const room = (s.maxEpisodes ?? 0) - s.episodes.length - (s.removedEpisodes?.length ?? 0);
  const add = useMutation({
    mutationFn: (count: number) => api<{ id: string }>(`/api/series/${s.id}/episodes`, { method: 'POST', body: JSON.stringify({ count }) }),
    onSuccess: (r) => navigate(`/generations/${r.id}`),
    onError: (err) => setError(((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not add episodes. Please try again.'),
  });
  if (room <= 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl">Add more episodes</h2>
      <p className="text-sm text-muted">New episodes continue this series with the same hosts, after episode {s.episodes.length + (s.removedEpisodes?.length ?? 0)}.</p>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 5].filter((n) => n <= room).map((n) => (
          <Button key={n} variant="secondary" onClick={() => add.mutate(n)} busy={add.isPending && add.variables === n} disabled={add.isPending}>
            <Plus aria-hidden size={18} /> {n === 1 ? '1 episode' : `${n} episodes`}
          </Button>
        ))}
      </div>
      {error && <Notice tone="error" role="alert">{error}</Notice>}
    </Card>
  );
}

/**
 * The owner switches the language the series is shown and played in. The text changes at once; audio in a
 * new language is made in the background, and each episode plays in its original language until then.
 */
function LanguageSwitch({ s }: { s: SeriesDetail }) {
  const qc = useQueryClient();
  const features = useFeatures();
  const settings = usePublicSettings();
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (language: string) => api<{ language: string; voicing: boolean }>(`/api/series/${s.id}/language`, { method: 'PUT', body: JSON.stringify({ language }) }),
    onMutate: () => setError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['series', s.id] }),
    onError: (err) => setError(((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not change the language. Please try again.'),
  });
  const voices = settings.data?.voices ?? [];
  const current = s.language ?? 'en';
  // The original, any language it already has, and (while switched on) every language with voices.
  const choices = LANGUAGES.filter(
    (l) => l.code === (s.originalLanguage ?? 'en') || s.languages?.includes(l.code) || (features.languages && voices.some((v) => v.speaks?.includes(l.code))),
  );
  if (choices.length < 2 || !['ready', 'partial'].includes(s.status)) return null;
  const voicing = s.episodes.filter((e) => e.languageStatus === 'voicing').length;
  return (
    <div className="-mt-2 mb-5 flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Language
        <select
          value={current}
          disabled={change.isPending}
          onChange={(e) => change.mutate(e.target.value)}
          className="min-h-11 rounded-xl border border-line bg-surface px-3 text-[0.95rem]"
        >
          {choices.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
              {l.code === s.originalLanguage ? ' (original)' : ''}
            </option>
          ))}
        </select>
        {change.isPending && (
          <span role="status" className="inline-flex items-center gap-1.5 text-muted">
            <LoaderCircle aria-hidden size={16} className="animate-spin" /> Translating…
          </span>
        )}
      </label>
      {voicing > 0 && !change.isPending && (
        <p role="status" className="text-sm text-muted">
          Recording the {languageInfo(current).name} audio for {voicing} episode{voicing === 1 ? '' : 's'}. Until each is ready, it plays in {languageInfo(s.originalLanguage).name}.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function SeriesView({ s }: { s: SeriesDetail }) {
  const location = useLocation();
  const qc = useQueryClient();
  const [shareNote, setShareNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  // An episode's own link: the owner can share any finished episode (the podcast becomes public if they agree).
  const canShare = s.isOwner || s.visibility === 'public';
  const shareEpisode = async (ep: EpisodeSummary) => {
    setShareNote(null);
    try {
      const slug = await publicSlugFor(s);
      if (!slug) return;
      if (s.visibility !== 'public') await qc.invalidateQueries({ queryKey: ['series', s.id] });
      const r = await shareTarget({ kind: 'episode', title: ep.title, seriesTitle: s.title, slug, number: ep.number });
      if (SHARE_NOTE[r]) setShareNote({ tone: r === 'failed' ? 'error' : 'info', text: SHARE_NOTE[r]! });
    } catch {
      setShareNote({ tone: 'error', text: 'Could not share this episode. Please try again.' });
    }
  };
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [s.id, location.hash]);
  const busy = !!s.activeGenerationId;
  const queue = s.episodes.filter((e) => e.status === 'ready').map((e) => toPlayable(e, s.title));
  const items = [
    ...s.episodes.map((ep) => ({ number: ep.number, node: <EpisodeCard key={ep.id} ep={ep} seriesTitle={s.title} queue={queue} onShare={canShare ? (e) => void shareEpisode(e) : undefined} language={s.language} /> })),
    ...(s.removedEpisodes ?? []).map((ep) => ({ number: ep.number, node: <RemovedEpisode key={ep.id} seriesId={s.id} ep={ep} disabled={busy} /> })),
  ].sort((a, b) => a.number - b.number);
  return (
    <div>
      <ShowArt seriesId={s.id} title={s.title} art={s.artwork?.selected} decorative className="mb-4 w-40 rounded-2xl shadow-card sm:w-48" />
      {s.isOwner && <ArtworkPicker s={s} />}
      <PageHeader title={s.title} subtitle={s.description} />
      {s.isOwner ? <LanguageSwitch s={s} /> : s.language && s.language !== 'en' ? <p className="-mt-3 mb-5 text-sm text-muted">In {languageInfo(s.language).native}</p> : null}
      {!s.isOwner && s.visibility === 'public' && <PublicActions s={s} />}
      {busy && (
        <div className="mb-5">
          <Notice>
            <span className="inline-flex items-center gap-2">
              <LoaderCircle aria-hidden size={18} className="animate-spin" /> We're working on this series.{' '}
              <Link to={`/generations/${s.activeGenerationId}`} className="font-semibold underline underline-offset-4">See progress</Link>
            </span>
          </Notice>
        </div>
      )}
      {shareNote && (
        <div className="mb-4">
          <Notice tone={shareNote.tone} role={shareNote.tone === 'error' ? 'alert' : 'status'}>
            {shareNote.text}
          </Notice>
        </div>
      )}
      <div className="flex flex-col gap-5">{items.map((x) => x.node)}</div>
      {s.isOwner && (
        <div className="mt-8 flex flex-col gap-4">
          {!busy && (s.status === 'ready' || s.status === 'partial') && <AddEpisodes s={s} />}
          <SeriesOwnerActions series={s} />
        </div>
      )}
    </div>
  );
}
