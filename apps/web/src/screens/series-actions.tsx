import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Compass, Globe, Layers, Lock, RefreshCw, Repeat, Share2, Trash2 } from 'lucide-react';
import { api, type ApiError } from '../lib/api';
import { Button, Card, Notice } from '../components/ui';

export async function shareLink(title: string, slug: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}/p/${slug}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: `${title} — ThinkMade`, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Owner tools: visibility, sharing, continued learning and deletion. */
export function SeriesOwnerActions({ series }: { series: { id: string; title: string; visibility: 'private' | 'public'; publicSlug: string | null; status: string } }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const visibility = useMutation({
    mutationFn: (v: 'private' | 'public') => api<{ visibility: string; publicSlug: string }>(`/api/series/${series.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: v }) }),
    onSuccess: async (r) => {
      setNote({ tone: 'info', text: r.visibility === 'public' ? 'This series is public. Anyone with the link can listen, and it can appear in Discover. Your original question, photos, videos and coaching stay private.' : 'This series is private again.' });
      await qc.invalidateQueries({ queryKey: ['series', series.id] });
    },
    onError: (err) => setNote({ tone: 'error', text: ((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not change who can see this series.' }),
  });
  const start = async (mode: 'explore' | 'deepen' | 'reinforce', update = false) => {
    setNote(null);
    try {
      const settings = await api<{ podcast: { defaultLengthMinutes: number; defaultEpisodes: number; speakerFormat: 'single' | 'two_hosts' | 'mixed' } }>('/api/settings/public');
      const { id } = await api<{ id: string }>('/api/generations', {
        method: 'POST',
        body: JSON.stringify({
          topic: '',
          parentSeriesId: series.id,
          update,
          customization: { lengthMinutes: settings.podcast.defaultLengthMinutes, episodes: settings.podcast.defaultEpisodes, speakerFormat: settings.podcast.speakerFormat, learningMode: mode },
        }),
      });
      navigate(`/generations/${id}`);
    } catch (err) {
      setNote({ tone: 'error', text: ((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not start. Please try again.' });
    }
  };
  const ready = series.status === 'ready' || series.status === 'partial';
  const btn = 'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold hover:bg-surface-2';
  return (
    <div className="flex flex-col gap-4">
      {ready && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl">Continue Learning</h2>
          <p className="text-sm text-muted">Build on this series without repeating what you have already covered.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={btn} onClick={() => void start('explore')}><Compass aria-hidden size={18} /> Explore new models</button>
            <button type="button" className={btn} onClick={() => void start('deepen')}><Layers aria-hidden size={18} /> Go deeper</button>
            <button type="button" className={btn} onClick={() => void start('reinforce')}><Repeat aria-hidden size={18} /> Reinforce with new books</button>
            <button type="button" className={btn} onClick={() => void start('explore', true)}><RefreshCw aria-hidden size={18} /> Get an update</button>
          </div>
        </Card>
      )}
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">Sharing</h2>
        <p className="flex items-center gap-2 text-[0.95rem]">
          {series.visibility === 'public' ? <Globe aria-hidden size={18} /> : <Lock aria-hidden size={18} />}
          {series.visibility === 'public' ? 'Public: anyone with the link can listen.' : 'Private: only you can see this series.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {series.visibility === 'public' ? (
            <>
              <button
                type="button"
                className={btn}
                onClick={async () => {
                  const r = await shareLink(series.title, series.publicSlug!);
                  setNote({ tone: r === 'failed' ? 'error' : 'info', text: r === 'copied' ? 'Link copied.' : r === 'shared' ? 'Shared.' : 'Could not share the link.' });
                }}
              >
                <Share2 aria-hidden size={18} /> Share link
              </button>
              <Button variant="secondary" onClick={() => visibility.mutate('private')} busy={visibility.isPending}>Make private</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => visibility.mutate('public')} busy={visibility.isPending} disabled={!ready}>Make public</Button>
          )}
        </div>
      </Card>
      {note && <Notice tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</Notice>}
      <DeleteSeries id={series.id} title={series.title} />
    </div>
  );
}

/** Compares a typed title with the real one, ignoring letter case, punctuation and extra spaces. */
export function sameTitle(typed: string, title: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return norm(typed) !== '' && norm(typed) === norm(title);
}

/** Deleting can't be undone, so the listener confirms by typing the series title. */
export function DeleteSeries({ id, title }: { id: string; title: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const del = useMutation({
    mutationFn: () => api(`/api/series/${id}`, { method: 'DELETE', body: '{}' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['library'] });
      await qc.invalidateQueries({ queryKey: ['series', 'mine'] });
      navigate('/library');
    },
    onError: () => setError('Could not delete this series. Please try again.'),
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-danger underline-offset-4 hover:underline">
        <Trash2 aria-hidden size={16} /> Delete this series
      </button>
    );
  }
  const matches = sameTitle(typed, title);
  return (
    <Card className="flex flex-col gap-3 border-danger/40">
      <h2 className="text-xl">Delete this series?</h2>
      <p className="text-[0.95rem]">
        This permanently deletes every episode, its audio and your listening history for it. It can't be undone.
      </p>
      <label htmlFor={inputId} className="text-sm">
        To confirm, type the series title: <span className="font-semibold">{title}</span>
      </label>
      <input
        id={inputId}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="min-h-12 rounded-xl border border-line bg-surface px-3 text-ink"
      />
      {error && <Notice tone="error" role="alert">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!matches} busy={del.isPending} onClick={() => del.mutate()}>
          Delete forever
        </Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setTyped(''); setError(null); }}>
          Keep it
        </Button>
      </div>
    </Card>
  );
}
