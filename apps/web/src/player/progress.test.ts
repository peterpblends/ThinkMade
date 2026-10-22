import { describe, expect, it } from 'vitest';
import { shouldSaveProgress } from './progress';

describe('shouldSaveProgress', () => {
  it('saves at most every five seconds during playback', () => {
    expect(shouldSaveProgress({ lastSavedAt: 1000, now: 4000, lastPositionMs: 0, positionMs: 3000 })).toBe(false);
    expect(shouldSaveProgress({ lastSavedAt: 1000, now: 6100, lastPositionMs: 0, positionMs: 5100 })).toBe(true);
  });
  it('does not save when the position has not moved', () => {
    expect(shouldSaveProgress({ lastSavedAt: 0, now: 60_000, lastPositionMs: 5000, positionMs: 5000 })).toBe(false);
  });
});
