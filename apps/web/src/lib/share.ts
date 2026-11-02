import { api } from './api';

/** What is being shared: a whole podcast, or one episode of it (which gets its own link). */
export type ShareTarget = { kind: 'podcast'; title: string; slug: string } | { kind: 'episode'; title: string; seriesTitle: string; slug: string; number: number };

export type ShareResult = 'shared' | 'copied' | 'failed' | 'cancelled';

export function shareUrl(t: ShareTarget): string {
  const base = `${window.location.origin}/p/${encodeURIComponent(t.slug)}`;
  return t.kind === 'episode' ? `${base}/e/${t.number}` : base;
}

/** Shares with the system share sheet where there is one, or copies the link. */
export async function shareTarget(t: ShareTarget): Promise<ShareResult> {
  const url = shareUrl(t);
  const title = t.kind === 'episode' ? `${t.title} — ${t.seriesTitle}` : t.title;
  try {
    if (navigator.share) {
      await navigator.share({ title: `${title} — ThinkMade`, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/**
 * The podcast's public link name, making it public first when its owner agrees: a link only works for a
 * public podcast. Returns null when the owner declines or it can't be made public.
 */
export async function publicSlugFor(series: { id: string; title: string; visibility: string; publicSlug: string | null }, confirm: (message: string) => boolean = (m) => window.confirm(m)): Promise<string | null> {
  if (series.visibility === 'public' && series.publicSlug) return series.publicSlug;
  if (!confirm(`To share, “${series.title}” becomes public: anyone with the link can listen, and it can appear in Discover. Your original question, photos and coaching stay private. Share it?`)) return null;
  const r = await api<{ visibility: string; publicSlug: string }>(`/api/series/${series.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });
  return r.publicSlug;
}

export const SHARE_NOTE: Record<ShareResult, string | null> = { shared: 'Shared.', copied: 'Link copied.', failed: 'Could not share the link.', cancelled: null };
