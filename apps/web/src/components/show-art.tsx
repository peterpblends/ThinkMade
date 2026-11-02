import { useState } from 'react';
import { useFeatures } from '../lib/features';

/** A short hash of the title, so a renamed show's cover isn't served from the cache. */
function titleVersion(title: string): string {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Where a show's cover is served (an SVG with the title in the brand typeface). */
export function coverUrl(seriesId: string, title: string): string {
  return `/api/series/${encodeURIComponent(seriesId)}/cover.svg?v=${titleVersion(title)}`;
}

/**
 * A show's cover art. Renders nothing while show artwork is switched off or the cover can't load, so callers
 * can place a fallback beside it with `fallback`.
 */
export function ShowArt({ seriesId, title, className = '', decorative = false, fallback = null }: { seriesId: string; title: string; className?: string; decorative?: boolean; fallback?: React.ReactNode }) {
  const features = useFeatures();
  const [failed, setFailed] = useState(false);
  if (!features.showArtwork || failed) return <>{fallback}</>;
  return (
    <img
      src={coverUrl(seriesId, title)}
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
