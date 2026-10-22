import { describe, expect, it } from 'vitest';
import { applyPlaybackEvent, type PlaybackEvent } from './playback';

const ev = (o: Partial<PlaybackEvent>): PlaybackEvent => ({ positionMs: 0, event: 'progress', clientUpdatedAt: '2026-10-22T10:00:00Z', deviceId: 'a', ...o });

describe('applyPlaybackEvent', () => {
  it('starts in progress from nothing', () => {
    expect(applyPlaybackEvent(null, ev({ positionMs: 5000 }), 100_000).next).toMatchObject({ positionMs: 5000, status: 'in_progress' });
  });
  it('drops an older event', () => {
    const cur = applyPlaybackEvent(null, ev({ positionMs: 9000, clientUpdatedAt: '2026-10-22T10:05:00Z' }), 100_000).next;
    expect(applyPlaybackEvent(cur, ev({ positionMs: 1000, clientUpdatedAt: '2026-10-22T10:00:00Z' }), 100_000).applied).toBe(false);
  });
  it('keeps a newer rewind', () => {
    const cur = applyPlaybackEvent(null, ev({ positionMs: 9000 }), 100_000).next;
    expect(applyPlaybackEvent(cur, ev({ positionMs: 1000, event: 'seek', clientUpdatedAt: '2026-10-22T10:01:00Z' }), 100_000).next.positionMs).toBe(1000);
  });
  it('completes at the threshold or on ended, and stays completed', () => {
    const done = applyPlaybackEvent(null, ev({ positionMs: 95_000 }), 100_000).next;
    expect(done.status).toBe('completed');
    expect(applyPlaybackEvent(null, ev({ positionMs: 10, event: 'ended' }), null).next.status).toBe('completed');
    expect(applyPlaybackEvent(done, ev({ positionMs: 100, event: 'seek', clientUpdatedAt: '2026-10-22T11:00:00Z' }), 100_000).next.status).toBe('completed');
  });
  it('honours a status set by hand', () => {
    const cur = applyPlaybackEvent(null, ev({ positionMs: 40_000 }), 100_000).next;
    const reset = applyPlaybackEvent(cur, ev({ event: 'status', status: 'not_started', clientUpdatedAt: '2026-10-22T10:02:00Z' }), 100_000).next;
    expect(reset).toMatchObject({ status: 'not_started', positionMs: 0, manualStatus: true });
  });
});
