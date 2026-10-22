import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BookOpen, CircleCheck, Heart, MessageCircleQuestion, Pause, Play, RotateCcw, RotateCw, Share2, SkipForward, Star } from 'lucide-react';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';
import type { EpisodeSummary } from '../lib/types';
import { LogoSymbol } from '../components/logo';
import { Notice } from '../components/ui';
import { RATES, usePlayer } from './player-context';
import { DownloadButton } from '../offline/download-button';
import { getDownload } from '../offline/downloads';
import { db } from '../offline/db';
import { flushOutbox, queueFavorite, queueRating } from '../offline/sync';

interface PlaybackInfo {
  positionMs: number;
  status: 'not_started' | 'in_progress' | 'completed';
  favorite: boolean;
  rating: number | null;
}

function Stars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Rate this episode" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-2"
        >
          <Star aria-hidden size={22} className={value && n <= value ? 'fill-accent text-accent' : 'text-muted'} />
        </button>
      ))}
    </div>
  );
}

export function PlayerScreen() {
  const p = usePlayer();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const id = p.current?.id;
  const detail = useQuery({
    queryKey: ['episode', id],
    queryFn: async () => {
      try {
        return await api<EpisodeSummary & { isOwner: boolean }>(`/api/episodes/${id}`);
      } catch (err) {
        const d = await getDownload(id!);
        if (d?.detail) return d.detail as EpisodeSummary & { isOwner: boolean };
        throw err;
      }
    },
    enabled: !!id,
  });
  const info = useQuery({
    queryKey: ['playback', id],
    queryFn: async () => {
      const local = await db.prefs.get(id!).catch(() => undefined);
      const server = await api<PlaybackInfo & { clientUpdatedAt: string | null }>(`/api/playback/${id}`).catch(() => null);
      const lp = await db.playback.get(id!).catch(() => undefined);
      // The newer of this device's record and the server's wins, matching the sync rules.
      const useLocal = !!lp && (!server || Date.parse(lp.clientUpdatedAt ?? '0') >= Date.parse(server.clientUpdatedAt ?? '0'));
      return {
        positionMs: useLocal ? lp!.positionMs : (server?.positionMs ?? 0),
        status: useLocal ? lp!.status : (server?.status ?? 'not_started'),
        favorite: local?.favorite ?? server?.favorite ?? false,
        rating: local?.rating ?? server?.rating ?? null,
      } satisfies PlaybackInfo;
    },
    enabled: !!id,
    retry: false,
  });
  const [shareNote, setShareNote] = useState<string | null>(null);

  if (!p.current) {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <p className="text-muted">Nothing is playing.</p>
        <Link to="/library" className="font-semibold text-accent-ink underline">Go to My Library</Link>
      </div>
    );
  }
  const ep = p.current;
  const remaining = Math.max(0, p.duration - p.position);
  // Favourites and ratings apply on this device at once and sync when online.
  const setFav = async (on: boolean) => {
    await queueFavorite(ep.id, on);
    await qc.invalidateQueries({ queryKey: ['playback', ep.id] });
    await flushOutbox();
    await qc.invalidateQueries({ queryKey: ['library'] });
  };
  const setRating = async (n: number) => {
    await queueRating(ep.id, n);
    await qc.invalidateQueries({ queryKey: ['playback', ep.id] });
    await flushOutbox();
  };
  const share = async () => {
    const series = await api<{ visibility: string; publicSlug: string | null }>(`/api/series/${ep.seriesId}`).catch(() => null);
    if (!series) {
      setShareNote('Sharing needs a connection.');
      return;
    }
    if (series.visibility !== 'public' || !series.publicSlug) {
      setShareNote('This podcast is private. Make it public from its series page to share it.');
      return;
    }
    const url = `${window.location.origin}/p/${series.publicSlug}`;
    if (navigator.share) await navigator.share({ title: ep.title, text: `${ep.title} — ThinkMade`, url }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      setShareNote('Link copied.');
    }
  };
  const status = info.data?.status;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <div className="flex h-44 w-44 items-center justify-center rounded-[2rem] bg-accent-strong text-[#F7F4EE] shadow-card">
          <LogoSymbol size={110} decorative />
        </div>
        {ep.primaryModelName && (
          <p className="rounded-full bg-sage-soft px-4 py-1.5 text-sm font-semibold text-sage-ink">
            Mental model: {ep.primaryModelName}
          </p>
        )}
        <div>
          <h1 className="text-2xl">{ep.title}</h1>
          <p className="text-muted">
            <Link to={`/series/${ep.seriesId}`} className="underline-offset-4 hover:underline">{ep.seriesTitle}</Link> · Episode {ep.number}
          </p>
        </div>
      </div>

      {p.error && <Notice tone="error" role="alert">{p.error}</Notice>}

      <div>
        <label htmlFor="seek" className="sr-only">Position</label>
        <input
          id="seek"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(p.duration))}
          step={1}
          value={Math.floor(p.position)}
          onChange={(e) => p.seek(Number(e.target.value))}
          aria-valuetext={`${formatClock(p.position)} of ${formatClock(p.duration)}`}
          className="h-11 w-full accent-[var(--tm-accent-strong)]"
        />
        <div className="flex justify-between text-sm tabular-nums text-muted">
          <span>{formatClock(p.position)}</span>
          <span aria-label={`${formatClock(remaining)} remaining`}>-{formatClock(remaining)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={() => p.skip(-15)} aria-label="Back 15 seconds" className="flex h-14 w-14 items-center justify-center rounded-full hover:bg-surface-2">
          <RotateCcw aria-hidden size={28} />
          <span aria-hidden className="absolute text-[0.6rem] font-bold">15</span>
        </button>
        <button type="button" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-strong text-on-accent shadow-card">
          {p.playing ? <Pause aria-hidden size={34} /> : <Play aria-hidden size={34} />}
        </button>
        <button type="button" onClick={() => p.skip(15)} aria-label="Forward 15 seconds" className="flex h-14 w-14 items-center justify-center rounded-full hover:bg-surface-2">
          <RotateCw aria-hidden size={28} />
          <span aria-hidden className="absolute text-[0.6rem] font-bold">15</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => p.setRate(RATES[(RATES.indexOf(p.rate as (typeof RATES)[number]) + 1) % RATES.length]!)}
          aria-label={`Playback speed ${p.rate}x. Change speed`}
          className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold tabular-nums"
        >
          {p.rate}×
        </button>
        {p.hasNext && (
          <button type="button" onClick={p.next} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold">
            <SkipForward aria-hidden size={18} /> Next episode
          </button>
        )}
        <button
          type="button"
          aria-pressed={!!info.data?.favorite}
          onClick={() => void setFav(!info.data?.favorite)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold"
        >
          <Heart aria-hidden size={18} className={info.data?.favorite ? 'fill-accent text-accent' : ''} /> {info.data?.favorite ? 'Favorited' : 'Favorite'}
        </button>
        <button type="button" onClick={() => void share()} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold">
          <Share2 aria-hidden size={18} /> Share
        </button>
        <button
          type="button"
          onClick={() => {
            p.markStatus(status === 'completed' ? 'not_started' : 'completed');
            setTimeout(() => void qc.invalidateQueries({ queryKey: ['playback', ep.id] }), 400);
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold"
        >
          <CircleCheck aria-hidden size={18} /> {status === 'completed' ? 'Mark as not started' : 'Mark as completed'}
        </button>
      </div>
      <div className="flex justify-center">
        <DownloadButton ep={ep} loadDetail={() => api(`/api/episodes/${ep.id}`)} />
      </div>
      {shareNote && <Notice>{shareNote}</Notice>}

      <div className="flex flex-col items-center gap-1">
        <Stars value={info.data?.rating ?? null} onChange={(n) => void setRating(n)} />
      </div>

      <button
        type="button"
        onClick={() => navigate(`/coach/${ep.id}`)}
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border-2 border-accent-strong px-5 text-[1.05rem] font-semibold text-accent-ink"
      >
        <MessageCircleQuestion aria-hidden size={22} /> Coach Me
      </button>

      {detail.data && (
        <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          {detail.data.keyTakeaways.length > 0 && (
            <div>
              <h2 className="text-lg">Key takeaways</h2>
              <ul className="mt-1 list-disc pl-5">{detail.data.keyTakeaways.map((k) => <li key={k}>{k}</li>)}</ul>
            </div>
          )}
          {detail.data.sources.length > 0 && (
            <div>
              <h2 className="flex items-center gap-1.5 text-lg"><BookOpen aria-hidden size={18} /> Books and sources</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {detail.data.sources.map((s) => (
                  <li key={s.title}>{s.url ? <a className="text-accent-ink underline underline-offset-4" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</li>
                ))}
              </ul>
            </div>
          )}
          {detail.data.transcript && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent-ink">Transcript</summary>
              <div className="whitespace-pre-line pt-2 text-[0.95rem] leading-relaxed">{detail.data.transcript}</div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
