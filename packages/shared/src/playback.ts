import { z } from 'zod';

export const LISTEN_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export type ListenStatus = (typeof LISTEN_STATUSES)[number];

export const playbackEventSchema = z.strictObject({
  positionMs: z.number().int().min(0).max(24 * 3600 * 1000),
  /** progress: periodic save; seek: the listener moved the playhead; pause/ended: player events; status: set by hand. */
  event: z.enum(['progress', 'seek', 'pause', 'ended', 'status']),
  status: z.enum(LISTEN_STATUSES).optional(),
  clientUpdatedAt: z.iso.datetime({ offset: true }),
  deviceId: z.string().min(1).max(100),
});
export type PlaybackEvent = z.infer<typeof playbackEventSchema>;

export interface PlaybackRecord {
  positionMs: number;
  status: ListenStatus;
  manualStatus: boolean;
  clientUpdatedAt: string | null;
  deviceId: string | null;
}

/**
 * Conflict rules shared by the server and the offline client:
 * - the most recent action wins (by the device's own timestamp), so a stale device cannot overwrite newer listening;
 *   a deliberate rewind is newer, so it is kept;
 * - an episode completes automatically once the position passes the threshold or playback ends;
 *   a completed episode stays completed when relistened to;
 * - a status set by hand wins over automatic status until the next status change.
 */
export function applyPlaybackEvent(
  current: PlaybackRecord | null,
  ev: PlaybackEvent,
  durationMs: number | null,
  threshold = 0.95,
): { next: PlaybackRecord; applied: boolean } {
  if (current?.clientUpdatedAt) {
    const cur = Date.parse(current.clientUpdatedAt);
    const inc = Date.parse(ev.clientUpdatedAt);
    if (inc < cur || (inc === cur && ev.event !== 'status' && ev.positionMs <= current.positionMs)) {
      return { next: current, applied: false };
    }
  }
  const base: PlaybackRecord = current ?? { positionMs: 0, status: 'not_started', manualStatus: false, clientUpdatedAt: null, deviceId: null };
  if (ev.event === 'status' && ev.status) {
    return {
      next: { ...base, status: ev.status, manualStatus: true, positionMs: ev.status === 'not_started' ? 0 : base.positionMs, clientUpdatedAt: ev.clientUpdatedAt, deviceId: ev.deviceId },
      applied: true,
    };
  }
  const reachedEnd = ev.event === 'ended' || (durationMs !== null && durationMs > 0 && ev.positionMs >= durationMs * threshold);
  let status: ListenStatus = base.status;
  if (base.status === 'completed' || reachedEnd) status = 'completed';
  else if (ev.positionMs > 0) status = 'in_progress';
  return {
    next: { positionMs: ev.positionMs, status, manualStatus: base.manualStatus && status === base.status, clientUpdatedAt: ev.clientUpdatedAt, deviceId: ev.deviceId },
    applied: true,
  };
}
