import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Compass, Search, Star } from 'lucide-react';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import { Notice, PageHeader } from '../components/ui';
import { ShowArt } from '../components/show-art';

export interface DiscoverResult {
  id: string;
  title: string;
  description: string;
  publicSlug: string;
  models: string[];
  episodeCount: number;
  totalSeconds: number;
  saves: number;
  averageRating: number | null;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ResultCard({ r }: { r: DiscoverResult }) {
  return (
    <li>
      <Link to={`/p/${r.publicSlug}`} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card hover:bg-surface-2">
        <ShowArt seriesId={r.id} title={r.title} decorative className="h-16 w-16 rounded-xl sm:h-20 sm:w-20" />
        <span className="flex min-w-0 flex-col gap-1.5">
        <span className="font-serif text-lg font-semibold">{r.title}</span>
        <span className="line-clamp-2 text-sm text-muted">{r.description}</span>
        <span className="flex flex-wrap gap-1.5 pt-1">
          {r.models.slice(0, 3).map((m) => (
            <span key={m} className="rounded-full bg-sage-soft px-2.5 py-0.5 text-xs font-semibold text-sage-ink">{m}</span>
          ))}
        </span>
        <span className="text-xs text-muted">
          {r.episodeCount} episode{r.episodeCount === 1 ? '' : 's'}
          {r.totalSeconds ? ` · ${formatDuration(r.totalSeconds)}` : ''}
          {r.averageRating ? (
            <>
              {' · '}
              <Star aria-hidden size={12} className="inline fill-accent text-accent" /> {r.averageRating.toFixed(1)}
            </>
          ) : null}
          {r.saves ? ` · saved ${r.saves} time${r.saves === 1 ? '' : 's'}` : ''}
        </span>
        </span>
      </Link>
    </li>
  );
}

export function DiscoverScreen() {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim());
  const res = useQuery({
    queryKey: ['discover', debounced],
    queryFn: () => api<{ results: DiscoverResult[] }>(`/api/discover${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`),
  });
  return (
    <div>
      <PageHeader title="Discover" subtitle="Podcasts other people have chosen to share." />
      <div className="relative mb-5">
        <Search aria-hidden size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <label htmlFor="discover-search" className="sr-only">Search public podcasts</label>
        <input
          id="discover-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="A topic, question, mental model, book or author"
          className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-ink placeholder:text-muted"
        />
      </div>
      {res.isError && <Notice tone="error" role="alert">Discover needs a connection.</Notice>}
      {res.data && res.data.results.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">{debounced ? `Results for “${debounced}”` : 'Recently shared'}</h2>
          <ul className="flex flex-col gap-3">{res.data.results.map((r) => <ResultCard key={r.id} r={r} />)}</ul>
        </>
      )}
      {res.data && res.data.results.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <Compass aria-hidden size={40} className="text-sage" />
          <p className="max-w-sm text-muted">
            {debounced ? 'Nothing shared matches that yet. ' : 'Nobody has shared a podcast yet. '}
            <Link to="/" className="font-semibold text-accent-ink underline">Create your own</Link>
          </p>
        </div>
      )}
    </div>
  );
}
