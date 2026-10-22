import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration } from './format';

describe('format', () => {
  it('formats durations for lists', () => {
    expect(formatDuration(754)).toBe('13 min');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(3900)).toBe('1 hr 5 min');
    expect(formatDuration(null)).toBe('');
  });
  it('formats a player clock', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
