import { applyPlaybackEvent, type PlaybackEvent } from '@thinkmade/shared';
import { db, type OutboxItem } from './db';

/** Local mirror of a listening position (works offline). */
export async function localPlayback(episodeId: string) {
  return db.playback.get(episodeId);
}

async function enqueue(item: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts'>) {
  await db.transaction('rw', db.outbox, async () => {
    await db.outbox.where('key').equals(item.key).delete();
    await db.outbox.add({ ...item, createdAt: new Date().toISOString(), attempts: 0 });
  });
}

/** Applies a progress event locally (same rules as the server) and queues it for the server. */
export async function queueProgress(episodeId: string, event: PlaybackEvent, durationMs: number | null, threshold = 0.95) {
  const current = await db.playback.get(episodeId);
  const { next, applied } = applyPlaybackEvent(current ?? null, event, durationMs, threshold);
  if (applied) await db.playback.put({ episodeId, ...next });
  // Status changes are queued separately so a later progress event cannot replace them before sync.
  await enqueue({ key: event.event === 'status' ? `status:${episodeId}` : `progress:${episodeId}`, method: 'PUT', path: `/api/playback/${episodeId}`, payload: event });
}

export async function queueFavorite(episodeId: string, on: boolean) {
  await db.prefs.put({ ...((await db.prefs.get(episodeId)) ?? { episodeId }), favorite: on });
  await enqueue({ key: `favorite:${episodeId}`, method: on ? 'PUT' : 'DELETE', path: `/api/favorites/${episodeId}`, payload: {} });
}

export async function queueRating(episodeId: string, stars: number) {
  await db.prefs.put({ ...((await db.prefs.get(episodeId)) ?? { episodeId }), rating: stars });
  await enqueue({ key: `rating:${episodeId}`, method: 'PUT', path: `/api/ratings/${episodeId}`, payload: { stars } });
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

/**
 * Sends queued changes oldest first. Stops at the first network failure (still offline) or auth
 * failure (signed out), keeping the rest. Drops items the server rejects as invalid or not found.
 */
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const items = await db.outbox.orderBy('createdAt').toArray();
      for (const item of items) {
        let res: Response;
        try {
          res = await fetch(item.path, {
            method: item.method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(item.payload),
            credentials: 'same-origin',
          });
        } catch {
          break;
        }
        if (res.ok) {
          await db.outbox.delete(item.id!);
          sent++;
        } else if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
          // Keep it for later, but drop an item the server has failed many times so it cannot block the queue.
          if (res.status >= 500 && item.attempts + 1 >= 8) {
            await db.outbox.delete(item.id!);
            continue;
          }
          await db.outbox.update(item.id!, { attempts: item.attempts + 1 });
          break;
        } else {
          await db.outbox.delete(item.id!);
        }
      }
      return { sent, remaining: await db.outbox.count() };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Flushes now and whenever connectivity or focus returns (iOS has no background sync). */
export function startSyncTriggers(onSynced?: (r: { sent: number; remaining: number }) => void) {
  const run = () => {
    if (navigator.onLine !== false) void flushOutbox().then((r) => r.sent && onSynced?.(r));
  };
  const onVisible = () => document.visibilityState === 'visible' && run();
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(run, 60_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
