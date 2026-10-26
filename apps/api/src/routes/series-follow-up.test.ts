import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { runNextJob, setFakeValidation } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
const PASS = () => ({ scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5, instructions: 5 }, passed: true, problems: [], sectionsToRevise: [], revisionNotes: '' });
afterEach(async () => {
  setFakeValidation(PASS);
  await ctx?.close();
  ctx = undefined;
});

const TWO = { lengthMinutes: 1, episodes: 2, speakerFormat: 'single', learningMode: 'explore' };

async function setup() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const admin = await signUpVerified(app, ctx, { email: 'root@example.com', role: 'admin', twoFactorEnabled: true });
  const user = await signUpVerified(app, ctx, { email: 'user@example.com' });
  const h = (c: string) => ({ cookie: c, 'content-type': 'application/json', origin: ctx!.env.APP_URL });
  return { app, admin, user, h };
}

/** A two-episode series whose second episode the reviewer holds; the admin then rejects it. */
async function seriesWithRejectedEpisode() {
  const s = await setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recorded stage input
  setFakeValidation((inp: any) => (String(inp.episode?.title).startsWith('Episode 2') ? { ...PASS(), scores: { ...PASS().scores, accuracy: 1 }, passed: false, problems: ['Inaccurate'] } : PASS()));
  const { id: jobId } = (await (await s.app.request('/api/generations', { method: 'POST', headers: s.h(s.user), body: JSON.stringify({ topic: 'Two episodes', customization: TWO }) })).json()) as { id: string };
  await runNextJob(ctx!.worker!);
  setFakeValidation(PASS);
  const [held] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.status, 'needs_review'));
  const res = await s.app.request(`/api/admin/quality/${held!.id}`, { method: 'POST', headers: s.h(s.admin), body: JSON.stringify({ decision: 'reject', note: 'Gets the history wrong.' }) });
  expect(res.status).toBe(200);
  return { ...s, jobId, rejectedId: held!.id, seriesId: held!.seriesId };
}

describe('episodes a reviewer rejects', () => {
  it('are taken off the series, and the rest of the series counts as complete', async () => {
    const { app, user, jobId, rejectedId, seriesId } = await seriesWithRejectedEpisode();
    const [ep] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.id, rejectedId));
    expect(ep!.status).toBe('rejected');
    const detail = (await (await app.request(`/api/series/${seriesId}`, { headers: { cookie: user } })).json()) as { status: string; episodes: Array<{ id: string }>; removedEpisodes: Array<{ id: string; number: number }> };
    expect(detail.episodes.map((e) => e.id)).not.toContain(rejectedId);
    expect(detail.removedEpisodes).toEqual([{ id: rejectedId, number: 2 }]);
    expect(detail.status).toBe('ready');
    const list = (await (await app.request('/api/series', { headers: { cookie: user } })).json()) as { series: Array<{ episodeCount: number; readyCount: number }> };
    expect(list.series[0]).toMatchObject({ episodeCount: 1, readyCount: 1 });
    const gen = (await (await app.request(`/api/generations/${jobId}`, { headers: { cookie: user } })).json()) as { status: string; error: string | null; episodes: unknown[] };
    expect(gen).toMatchObject({ status: 'succeeded', error: null });
    expect(gen.episodes).toHaveLength(1);
  });

  it('can be replaced by a new episode in the same place', async () => {
    const { app, user, h, rejectedId, seriesId } = await seriesWithRejectedEpisode();
    const res = await app.request(`/api/series/${seriesId}/episodes/${rejectedId}/replace`, { method: 'POST', headers: h(user), body: '{}' });
    expect(res.status).toBe(202);
    // Only one job per series at a time.
    expect((await app.request(`/api/series/${seriesId}/episodes`, { method: 'POST', headers: h(user), body: JSON.stringify({ count: 1 }) })).status).toBe(409);
    await runNextJob(ctx!.worker!);
    const [ep] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.id, rejectedId));
    expect(ep).toMatchObject({ status: 'ready', number: 2 });
    const detail = (await (await app.request(`/api/series/${seriesId}`, { headers: { cookie: user } })).json()) as { status: string; episodes: Array<{ number: number; status: string }>; removedEpisodes: unknown[] };
    expect(detail.episodes.map((e) => [e.number, e.status])).toEqual([[1, 'ready'], [2, 'ready']]);
    expect(detail.removedEpisodes).toEqual([]);
    expect(detail.status).toBe('ready');
    // The replacement planner was told why the old version was rejected.
    const stages = await ctx!.db.select().from(schema.generationStage).where(eq(schema.generationStage.note, 'Replacement for episode 2'));
    expect(stages).toHaveLength(1);
  });

  it('goes back to removed when its replacement is cancelled', async () => {
    const { app, user, h, rejectedId, seriesId } = await seriesWithRejectedEpisode();
    const { id } = (await (await app.request(`/api/series/${seriesId}/episodes/${rejectedId}/replace`, { method: 'POST', headers: h(user), body: '{}' })).json()) as { id: string };
    expect((await app.request(`/api/generations/${id}/cancel`, { method: 'POST', headers: h(user), body: '{}' })).status).toBe(200);
    const detail = (await (await app.request(`/api/series/${seriesId}`, { headers: { cookie: user } })).json()) as { status: string; removedEpisodes: Array<{ id: string }>; activeGenerationId: string | null };
    expect(detail).toMatchObject({ status: 'ready', activeGenerationId: null, removedEpisodes: [{ id: rejectedId, number: 2 }] });
  });

  it('cannot be replaced by someone else, and a kept episode cannot be "replaced"', async () => {
    const { app, admin, user, h, rejectedId, seriesId } = await seriesWithRejectedEpisode();
    expect((await app.request(`/api/series/${seriesId}/episodes/${rejectedId}/replace`, { method: 'POST', headers: h(admin), body: '{}' })).status).toBe(404);
    const [kept] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.status, 'ready'));
    expect((await app.request(`/api/series/${seriesId}/episodes/${kept!.id}/replace`, { method: 'POST', headers: h(user), body: '{}' })).status).toBe(409);
  });

  it('hide the series from My Podcasts when every episode was rejected', async () => {
    const s = await setup();
    setFakeValidation(() => ({ ...PASS(), scores: { ...PASS().scores, accuracy: 1 }, passed: false }));
    await s.app.request('/api/generations', { method: 'POST', headers: s.h(s.user), body: JSON.stringify({ topic: 'All bad', customization: { ...TWO, episodes: 1 } }) });
    await runNextJob(ctx!.worker!);
    const [held] = await ctx!.db.select().from(schema.episode);
    await s.app.request(`/api/admin/quality/${held!.id}`, { method: 'POST', headers: s.h(s.admin), body: JSON.stringify({ decision: 'reject', note: 'Not usable.' }) });
    const list = (await (await s.app.request('/api/series', { headers: { cookie: s.user } })).json()) as { series: unknown[] };
    expect(list.series).toEqual([]);
  });
});

describe('My Podcasts', () => {
  it("lists only the listener's own series", async () => {
    const { app, admin, user, h } = await setup();
    await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'Mine', customization: TWO }) });
    await runNextJob(ctx!.worker!);
    const theirs = (await (await app.request('/api/series', { headers: { cookie: admin } })).json()) as { series: unknown[] };
    expect(theirs.series).toEqual([]);
    const mine = (await (await app.request('/api/series', { headers: { cookie: user } })).json()) as { series: unknown[] };
    expect(mine.series).toHaveLength(1);
  });
});

describe('adding episodes to a series', () => {
  it('plans and records new episodes after the last one, with the same hosts', async () => {
    const { app, user, h } = await setup();
    await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'Grow this series', customization: TWO }) });
    await runNextJob(ctx!.worker!);
    const [series] = await ctx!.db.select().from(schema.podcastSeries);
    const res = await app.request(`/api/series/${series!.id}/episodes`, { method: 'POST', headers: h(user), body: JSON.stringify({ count: 2 }) });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    await runNextJob(ctx!.worker!);
    const gen = (await (await app.request(`/api/generations/${id}`, { headers: { cookie: user } })).json()) as { status: string };
    expect(gen.status).toBe('succeeded');
    const eps = await ctx!.db.select().from(schema.episode).orderBy(schema.episode.number);
    expect(eps.map((e) => [e.number, e.status])).toEqual([[1, 'ready'], [2, 'ready'], [3, 'ready'], [4, 'ready']]);
    expect(eps[3]!.hosts).toEqual(eps[0]!.hosts);
    // New episodes continue the series rather than repeating its models first.
    expect(eps[2]!.primaryMentalModelId).not.toBe(eps[0]!.primaryMentalModelId);
    expect(eps[2]!.primaryMentalModelId).not.toBe(eps[1]!.primaryMentalModelId);
  });

  it('stays within the most episodes a series may have', async () => {
    const { app, user, h } = await setup();
    await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'Near the limit', customization: TWO }) });
    await runNextJob(ctx!.worker!);
    const [series] = await ctx!.db.select().from(schema.podcastSeries);
    await ctx!.settings.update({ podcast: { maxEpisodesPerSeries: 3 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    const res = await app.request(`/api/series/${series!.id}/episodes`, { method: 'POST', headers: h(user), body: JSON.stringify({ count: 2 }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/up to 1 more episode/);
  });
});
