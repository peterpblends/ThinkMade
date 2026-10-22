import type { PlaybackEvent } from '@thinkmade/shared';

const DEVICE_KEY = 'tm-device-id';

/** A stable, random identifier for this browser, used to resolve progress from several devices. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}

export function shouldSaveProgress(o: { lastSavedAt: number; now: number; lastPositionMs: number; positionMs: number }): boolean {
  return o.now - o.lastSavedAt >= 5000 && Math.abs(o.positionMs - o.lastPositionMs) >= 1000;
}

export type ProgressSender = (episodeId: string, event: PlaybackEvent, opts?: { keepalive?: boolean }) => Promise<void>;

/** Default sender: straight to the API. Phase 6 replaces this with the offline-first queue. */
export const sendProgressOnline: ProgressSender = async (episodeId, event, opts) => {
  await fetch(`/api/playback/${episodeId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    credentials: 'same-origin',
    keepalive: opts?.keepalive ?? false,
  }).catch(() => {});
};
