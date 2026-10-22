import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Heart, Library as LibraryIcon, Play, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/auth-client';
import { formatDuration } from '../lib/format';
import type { SeriesListItem } from '../lib/types';
import { usePlayer, type PlayableEpisode } from '../player/player-context';
import { PageHeader } from '../components/ui';

export interface LibraryEpisode {
  id: string;
  seriesId: string;
  seriesTitle: string;
  number: number;
  title: string;
  description: string;
  durationSeconds: number | null;
  positionMs: number;
  listenStatus: 'not_started' | 'in_progress' | 'completed';
  favorite: boolean;
  rating: number | null;
  primaryModel: { slug: string; name: string } | null;
  audioUrl: string;
}

interface LibraryData {
  episodes: LibraryEpisode[];
  continueListening: LibraryEpisode[];
  completed: LibraryEpisode[];
  favorites: LibraryEpisode[];
  models: Array<{ slug: string; name: string }>;
}

export const TABS = ['Continue Listening', 'My Podcasts', 'Downloads', 'Completed', 'Favorites'] as const;
export type LibraryTab = (typeof TABS)[number];

export function toPlayableFromLibrary(e: LibraryEpisode): PlayableEpisode {
  return { id: e.id, title: e.title, seriesId: e.seriesId, seriesTitle: e.seriesTitle, number: e.number, primaryModelName: e.primaryModel?.name ?? null, audioUrl: e.audioUrl, durationSeconds: e.durationSeconds };
}

export function EpisodeRow({ e, queue, extra }: { e: LibraryEpisode; queue: LibraryEpisode[]; extra?: React.ReactNode }) {
  const player = usePlayer();
  const pct = e.durationSeconds ? Math.min(100, (e.positionMs / 1000 / e.durationSeconds) * 100) : 0;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
      <button
        type="button"
        onClick={() => player.play(toPlayableFromLibrary(e), { queue: queue.map(toPlayableFromLibrary), startAtMs: e.listenStatus === 'completed' ? 0 : e.positionMs })}
        aria-label={`Play ${e.title}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-strong text-on-accent"
      >
        <Play aria-hidden size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <Link to={`/series/${e.seriesId}#${e.id}`} className="block truncate font-semibold hover:underline">
          {e.title}
        </Link>
        <p className="truncate text-sm text-muted">
          {e.primaryModel?.name ?? e.seriesTitle}
          {e.durationSeconds ? ` · ${formatDuration(e.durationSeconds)}` : ''}
          {e.listenStatus === 'completed' ? ' · Completed' : e.listenStatus === 'in_progress' ? ` · ${formatDuration(Math.max(60, (e.durationSeconds ?? 0) - e.positionMs / 1000))} left` : ''}
        </p>
        {e.listenStatus === 'in_progress' && (
          <div className="mt-1.5 h-1 rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {e.favorite && <Heart aria-label="Favorite" size={18} className="shrink-0 fill-accent text-accent" />}
      {e.listenStatus === 'completed' && <CheckCircle2 aria-hidden size={18} className="shrink-0 text-sage-ink" />}
      {extra}
    </li>
  );
}

function SeriesRow({ s }: { s: SeriesListItem }) {
  return (
    <li>
      <Link to={`/series/${s.id}`} className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 shadow-card hover:bg-surface-2">
        <span className="font-serif text-lg font-semibold">{s.title}</span>
        <span className="text-sm text-muted">
          {s.status === 'generating' ? 'Being created · ' : ''}
          {s.readyCount} of {s.episodeCount} episodes ready{s.totalSeconds ? ` · ${formatDuration(s.totalSeconds)}` : ''}
          {s.visibility === 'public' ? ' · Public' : ''}
        </span>
      </Link>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 text-center">
      <LibraryIcon aria-hidden size={40} className="text-sage" />
      <div className="max-w-sm text-muted">{children}</div>
    </div>
  );
}

interface GenerationListItem {
  id: string;
  status: string;
  label: string;
  topic: string | null;
}

/** Overridable so Phase 6 can supply the downloads list without this file knowing about storage. */
export function LibraryScreen({ downloads }: { downloads?: React.ReactNode }) {
  const { user } = useSession();
  const [tab, setTab] = useState<LibraryTab>('Continue Listening');
  const [q, setQ] = useState('');
  const [model, setModel] = useState('');
  const [sort, setSort] = useState('recent');
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(model ? { model } : {}), sort });
  const lib = useQuery({ queryKey: ['library', q, model, sort], queryFn: () => api<LibraryData>(`/api/library?${params}`), enabled: !!user });
  const series = useQuery({ queryKey: ['series', 'mine'], queryFn: () => api<{ series: SeriesListItem[] }>('/api/series'), enabled: !!user });
  const gens = useQuery({ queryKey: ['generations'], queryFn: () => api<{ generations: GenerationListItem[] }>('/api/generations'), enabled: !!user?.emailVerified, refetchInterval: 5000 });
  const active = (gens.data?.generations ?? []).filter((g) => g.status === 'queued' || g.status === 'running');

  if (!user) {
    return (
      <div>
        <PageHeader title="My Library" />
        <p className="text-muted">
          <Link className="font-semibold text-accent-ink underline" to="/sign-in?next=/library">Sign in</Link> to see your podcasts.
        </p>
      </div>
    );
  }

  const list = (items: LibraryEpisode[] | undefined, empty: React.ReactNode) =>
    items && items.length ? (
      <ul className="flex flex-col gap-2">{items.map((e) => <EpisodeRow key={e.id} e={e} queue={items} />)}</ul>
    ) : (
      <Empty>{empty}</Empty>
    );

  const showFilters = tab !== 'Downloads' && (lib.data?.episodes.length || q || model);
  return (
    <div>
      <PageHeader title="My Library" />
      <div role="tablist" aria-label="Library sections" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="min-h-11 shrink-0 rounded-full border border-line px-4 text-[0.95rem] aria-selected:border-accent-strong aria-selected:bg-accent-strong aria-selected:text-on-accent"
          >
            {t}
          </button>
        ))}
      </div>

      {showFilters ? (
        <div className="mb-4 flex flex-col gap-2">
          <div className="relative">
            <Search aria-hidden size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <label htmlFor="lib-search" className="sr-only">Search my podcasts</label>
            <input id="lib-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, topics and mental models" className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-ink placeholder:text-muted" />
          </div>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="lib-model">Filter by mental model</label>
            <select id="lib-model" value={model} onChange={(e) => setModel(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-sm">
              <option value="">All mental models</option>
              {lib.data?.models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="lib-sort">Sort</label>
            <select id="lib-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 rounded-full border border-line bg-surface px-3 text-sm">
              <option value="recent">Recent</option>
              <option value="title">Title</option>
              <option value="duration">Longest</option>
              <option value="series">Series</option>
            </select>
          </div>
        </div>
      ) : null}

      <div role="tabpanel" aria-label={tab}>
        {active.length > 0 && (tab === 'Continue Listening' || tab === 'My Podcasts') && (
          <section aria-labelledby="in-progress" className="mb-6">
            <h2 id="in-progress" className="mb-2 text-lg">Being created</h2>
            <ul className="flex flex-col gap-2">
              {active.map((g) => (
                <li key={g.id}>
                  <Link to={`/generations/${g.id}`} className="flex flex-col rounded-2xl border border-line bg-surface p-4 hover:bg-surface-2">
                    <span className="font-semibold">{g.topic || 'Your photo or video'}</span>
                    <span className="text-sm text-muted">{g.label}…</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {tab === 'Continue Listening' && list(lib.data?.continueListening, <>Episodes you've started appear here. <Link to="/" className="font-semibold text-accent-ink underline">Create a series</Link> or open My Podcasts.</>)}
        {tab === 'My Podcasts' &&
          (series.data?.series.length ? (
            <ul className="flex flex-col gap-3">{series.data.series.map((s) => <SeriesRow key={s.id} s={s} />)}</ul>
          ) : (
            <Empty>
              Nothing here yet. Your podcasts appear here as soon as you create them. <Link to="/" className="font-semibold text-accent-ink underline">Create your first series</Link>
            </Empty>
          ))}
        {tab === 'Downloads' && (downloads ?? <Empty>Downloads arrive with offline listening.</Empty>)}
        {tab === 'Completed' && list(lib.data?.completed, 'Episodes you finish appear here.')}
        {tab === 'Favorites' && list(lib.data?.favorites, 'Tap the heart in the player to save favorites here.')}
      </div>
    </div>
  );
}
