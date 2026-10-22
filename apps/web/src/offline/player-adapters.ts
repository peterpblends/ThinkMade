import type { PlayableEpisode } from '../player/player-context';
import type { ProgressSender } from '../player/progress';
import { getDownload } from './downloads';
import { flushOutbox, localPlayback, queueProgress } from './sync';

const objectUrls = new Map<string, string>();

/** Plays the downloaded copy when there is one, so listening works offline. */
export async function resolveSource(ep: PlayableEpisode): Promise<string> {
  const d = await getDownload(ep.id).catch(() => undefined);
  if (!d) return ep.audioUrl;
  for (const [id, url] of objectUrls) {
    if (id !== ep.id) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  }
  const existing = objectUrls.get(ep.id);
  if (existing) return existing;
  const url = URL.createObjectURL(d.blob);
  objectUrls.set(ep.id, url);
  return url;
}

/** Offline-first progress: record locally with the shared rules, queue for the server, try to send now. */
export function makeOfflineSender(durationFor: (episodeId: string) => number | null): ProgressSender {
  return async (episodeId, event, opts) => {
    await queueProgress(episodeId, event, durationFor(episodeId));
    if (opts?.keepalive) {
      // The page may be closing; also send directly in case IndexedDB work does not finish.
      void fetch(`/api/playback/${episodeId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), credentials: 'same-origin', keepalive: true }).catch(() => {});
    } else {
      void flushOutbox();
    }
  };
}

/** Where to resume: the newer of the server's and this device's saved positions. */
export async function startPositionFor(episodeId: string): Promise<number> {
  const local = await localPlayback(episodeId).catch(() => undefined);
  const server = await fetch(`/api/playback/${episodeId}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ positionMs: number; status: string; clientUpdatedAt: string | null }>) : null))
    .catch(() => null);
  const pick = [local, server]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Date.parse(b.clientUpdatedAt ?? '0') - Date.parse(a.clientUpdatedAt ?? '0'))[0];
  if (!pick || pick.status === 'completed') return 0;
  return pick.positionMs;
}
