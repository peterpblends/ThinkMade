import { useState, useSyncExternalStore } from 'react';
import { useFeatures } from '../lib/features';

/** A short hash of the title, so a renamed show's cover isn't served from the cache. */
function titleVersion(title: string): string {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// Artwork the listener picked in this session, so every cover of that show (player, library) changes at once.
const chosen = new Map<string, number>();
const listeners = new Set<() => void>();
let changes = 0;
export function rememberArtwork(seriesId: string, art: number) {
  chosen.set(seriesId, art);
  changes++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Where a show's cover is served (an SVG with the title in the brand typeface), for its artwork version. */
export function coverUrl(seriesId: string, title: string, art?: number): string {
  const a = chosen.get(seriesId) ?? art;
  return `/api/series/${encodeURIComponent(seriesId)}/cover.svg?v=${titleVersion(title)}${a !== undefined ? `&a=${a}` : ''}`;
}

/** One artwork version of a show, for choosing between them. */
export function artworkOptionUrl(seriesId: string, title: string, art: number): string {
  return `/api/series/${encodeURIComponent(seriesId)}/cover.svg?v=${titleVersion(title)}&art=${art}`;
}

/**
 * A show's cover art. Renders nothing while show artwork is switched off or the cover can't load, so callers
 * can place a fallback beside it with `fallback`.
 */
export function ShowArt({ seriesId, title, art, className = '', decorative = false, fallback = null }: { seriesId: string; title: string; art?: number | undefined; className?: string; decorative?: boolean; fallback?: React.ReactNode }) {
  const features = useFeatures();
  useSyncExternalStore(subscribe, () => changes);
  const [failed, setFailed] = useState(false);
  if (!features.showArtwork || failed) return <>{fallback}</>;
  return (
    <img
      src={coverUrl(seriesId, title, art)}
      alt={decorative ? '' : `Cover art for ${title}`}
      loading="lazy"
      decoding="async"
      width={1400}
      height={1400}
      onError={() => setFailed(true)}
      className={`aspect-square shrink-0 bg-surface-2 object-cover ${className}`}
    />
  );
}
