import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicSlugFor, shareTarget, shareUrl } from './share';

afterEach(() => vi.unstubAllGlobals());

describe('sharing', () => {
  it('links a podcast to the podcast and an episode to that episode', () => {
    expect(shareUrl({ kind: 'podcast', title: 'Habit Loops', slug: 'habit-loops' })).toBe(`${window.location.origin}/p/habit-loops`);
    expect(shareUrl({ kind: 'episode', title: 'Cue', seriesTitle: 'Habit Loops', slug: 'habit-loops', number: 3 })).toBe(`${window.location.origin}/p/habit-loops/e/3`);
  });

  it("uses the system share sheet with the episode's own title and link", async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, share });
    expect(await shareTarget({ kind: 'episode', title: 'Cue', seriesTitle: 'Habit Loops', slug: 'habit-loops', number: 3 })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Cue — Habit Loops — ThinkMade', url: `${window.location.origin}/p/habit-loops/e/3` });
  });

  it('makes a private podcast public only when its owner agrees', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ visibility: 'public', publicSlug: 'habit-loops' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const series = { id: 's1', title: 'Habit Loops', visibility: 'private', publicSlug: null };
    expect(await publicSlugFor(series, () => false)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await publicSlugFor(series, () => true)).toBe('habit-loops');
    expect(fetch).toHaveBeenCalledWith('/api/series/s1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) }));
    expect(await publicSlugFor({ ...series, visibility: 'public', publicSlug: 'already' }, () => false)).toBe('already');
  });
});
