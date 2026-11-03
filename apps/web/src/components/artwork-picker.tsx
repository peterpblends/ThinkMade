import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import { api, type ApiError } from '../lib/api';
import { useFeatures } from '../lib/features';
import type { SeriesDetail } from '../lib/types';
import { Notice } from './ui';
import { artworkOptionUrl, rememberArtwork } from './show-art';

type Artwork = NonNullable<SeriesDetail['artwork']>;

/**
 * For the owner: make new artwork for the show (a few times) and switch between every version made so far,
 * including the original.
 */
export function ArtworkPicker({ s }: { s: SeriesDetail }) {
  const qc = useQueryClient();
  const features = useFeatures();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const art = s.artwork ?? { selected: 0, count: 1, regenerationsLeft: 3 };
  const applied = (a: Artwork) => {
    rememberArtwork(s.id, a.selected);
    qc.setQueryData<SeriesDetail>(['series', s.id], (old) => (old ? { ...old, artwork: a } : old));
    void qc.invalidateQueries({ queryKey: ['series'] });
  };
  const onError = (err: unknown) => setError(((err as ApiError).body as { message?: string } | null)?.message ?? 'Could not change the artwork. Please try again.');
  const make = useMutation({
    mutationFn: () => api<Artwork>(`/api/series/${s.id}/artwork`, { method: 'POST' }),
    onMutate: () => setError(null),
    onSuccess: applied,
    onError,
  });
  const choose = useMutation({
    mutationFn: (selected: number) => api<Artwork>(`/api/series/${s.id}/artwork`, { method: 'PUT', body: JSON.stringify({ selected }) }),
    onMutate: () => setError(null),
    onSuccess: applied,
    onError,
  });
  if (!features.showArtwork) return null;
  const left = art.regenerationsLeft ?? 0;
  const busy = make.isPending || choose.isPending;
  return (
    <div className="-mt-1 mb-5 flex flex-col gap-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="self-start text-sm font-semibold text-accent-ink underline underline-offset-4">
        {open ? 'Done with artwork' : 'Change artwork'}
      </button>
      {open && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div role="radiogroup" aria-label="Artwork" className="flex flex-wrap gap-3">
            {Array.from({ length: art.count }, (_, n) => {
              const on = n === art.selected;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={n === 0 ? 'Original artwork' : `New artwork ${n}`}
                  disabled={busy}
                  onClick={() => !on && choose.mutate(n)}
                  className={`relative overflow-hidden rounded-xl ring-offset-2 ring-offset-surface ${on ? 'ring-[3px] ring-accent' : 'ring-1 ring-line hover:ring-2 hover:ring-accent/60'}`}
                >
                  <img src={artworkOptionUrl(s.id, s.title, n)} alt="" width={96} height={96} loading="lazy" className="h-24 w-24 bg-surface-2 object-cover" />
                  {on && (
                    <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-[#F7F4EE]">
                      <Check aria-hidden size={14} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || left === 0}
              onClick={() => make.mutate()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 font-semibold disabled:opacity-50"
            >
              {make.isPending ? <LoaderCircle aria-hidden size={18} className="animate-spin" /> : <Sparkles aria-hidden size={18} />}
              Make new artwork
            </button>
            <span className="text-sm text-muted" role="status">
              {left > 0 ? `${left} new design${left === 1 ? '' : 's'} left. You can always go back to any version.` : 'No new designs left, but you can switch between the ones you have.'}
            </span>
          </div>
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
