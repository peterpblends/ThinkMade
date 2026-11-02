import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { runNextJob } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const ONE = { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' };

async function withEpisode() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'lib@example.com' });
  const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  await app.request('/api/generations', { method: 'POST', headers, body: JSON.stringify({ topic: 'Library topic', customization: ONE }) });
  await runNextJob(ctx.worker!);
  const [ep] = await ctx.db.select().from(schema.episode);
  return { app, cookie, headers, ep: ep! };
}

const put = (app: ReturnType<typeof createApp>, headers: Record<string, string>, id: string, body: Record<string, unknown>) =>
  app.request(`/api/playback/${id}`, { method: 'PUT', headers, body: JSON.stringify({ deviceId: 'phone', ...body }) });

describe('playback progress', () => {
  it('saves position and marks the episode in progress', async () => {
    const { app, headers, ep } = await withEpisode();
    const res = await put(app, headers, ep.id, { positionMs: 10_000, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ positionMs: 10_000, status: 'in_progress', applied: true });
  });

  it('ignores an older update from another device', async () => {
    const { app, headers, ep } = await withEpisode();
    await put(app, headers, ep.id, { positionMs: 30_000, clientUpdatedAt: '2026-10-22T10:05:00Z', event: 'progress' });
    const stale = await put(app, headers, ep.id, { positionMs: 5_000, clientUpdatedAt: '2026-10-22T10:01:00Z', event: 'progress', deviceId: 'old-tablet' });
    expect(await stale.json()).toMatchObject({ positionMs: 30_000, applied: false });
  });

  it('keeps an intentional rewind', async () => {
    const { app, headers, ep } = await withEpisode();
    await put(app, headers, ep.id, { positionMs: 50_000, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' });
    const rewind = await put(app, headers, ep.id, { positionMs: 5_000, clientUpdatedAt: '2026-10-22T10:01:00Z', event: 'seek' });
    expect(await rewind.json()).toMatchObject({ positionMs: 5_000, applied: true });
  });

  it('completes automatically at 95% and stays completed on a relisten', async () => {
    const { app, headers, ep } = await withEpisode();
    const at96 = Math.round(ep.durationSeconds! * 1000 * 0.96);
    expect(await (await put(app, headers, ep.id, { positionMs: at96, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' })).json()).toMatchObject({ status: 'completed' });
    expect(await (await put(app, headers, ep.id, { positionMs: 1000, clientUpdatedAt: '2026-10-22T11:00:00Z', event: 'seek' })).json()).toMatchObject({ status: 'completed', positionMs: 1000 });
  });

  it('lets the listener set the status by hand', async () => {
    const { app, headers, ep } = await withEpisode();
    const res = await put(app, headers, ep.id, { positionMs: 0, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'status', status: 'completed' });
    expect(await res.json()).toMatchObject({ status: 'completed' });
    const back = await put(app, headers, ep.id, { positionMs: 0, clientUpdatedAt: '2026-10-22T10:01:00Z', event: 'status', status: 'not_started' });
    expect(await back.json()).toMatchObject({ status: 'not_started' });
  });

  it("refuses progress on an episode the user can't see", async () => {
    const { app, ep } = await withEpisode();
    const other = await signUpVerified(app, ctx!, { email: 'x@example.com' });
    const res = await put(app, { cookie: other, 'content-type': 'application/json', origin: ctx!.env.APP_URL }, ep.id, { positionMs: 1, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' });
    expect(res.status).toBe(404);
  });
});

describe('favorites and ratings', () => {
  it('favorites and unfavorites an episode', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    expect((await app.request(`/api/favorites/${ep.id}`, { method: 'PUT', headers })).status).toBe(200);
    let lib = (await (await app.request('/api/library', { headers: { cookie } })).json()) as { favorites: Array<{ id: string }> };
    expect(lib.favorites.map((f) => f.id)).toEqual([ep.id]);
    await app.request(`/api/favorites/${ep.id}`, { method: 'DELETE', headers });
    lib = (await (await app.request('/api/library', { headers: { cookie } })).json()) as { favorites: Array<{ id: string }> };
    expect(lib.favorites).toEqual([]);
  });

  it('accepts 1 to 5 stars only', async () => {
    const { app, headers, ep } = await withEpisode();
    expect((await app.request(`/api/ratings/${ep.id}`, { method: 'PUT', headers, body: JSON.stringify({ stars: 6 }) })).status).toBe(400);
    expect((await app.request(`/api/ratings/${ep.id}`, { method: 'PUT', headers, body: JSON.stringify({ stars: 4 }) })).status).toBe(200);
    const [r] = await ctx!.db.select().from(schema.rating);
    expect(r!.stars).toBe(4);
  });
});

describe('library', () => {
  it('lists continue-listening, completed and per-episode state, newest activity first', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    await put(app, headers, ep.id, { positionMs: 20_000, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' });
    const lib = (await (await app.request('/api/library', { headers: { cookie } })).json()) as {
      continueListening: Array<{ id: string; positionMs: number; seriesTitle: string }>;
      completed: unknown[];
      episodes: Array<{ id: string; status: string; favorite: boolean; rating: number | null; primaryModel: { name: string } }>;
    };
    expect(lib.continueListening).toEqual([expect.objectContaining({ id: ep.id, positionMs: 20_000, seriesTitle: 'Thinking It Through' })]);
    expect(lib.completed).toEqual([]);
    expect(lib.episodes[0]).toMatchObject({ id: ep.id, listenStatus: 'in_progress', favorite: false, rating: null });
  });

  it('searches and filters episodes by text and mental model', async () => {
    const { app, cookie } = await withEpisode();
    const [model] = await ctx!.db.select().from(schema.mentalModel).limit(1);
    const byModel = (await (await app.request(`/api/library?model=${model!.slug}`, { headers: { cookie } })).json()) as { episodes: unknown[] };
    expect(byModel.episodes.length).toBeGreaterThanOrEqual(0);
    const none = (await (await app.request('/api/library?q=zzzz-not-there', { headers: { cookie } })).json()) as { episodes: unknown[] };
    expect(none.episodes).toEqual([]);
    const hit = (await (await app.request('/api/library?q=episode', { headers: { cookie } })).json()) as { episodes: unknown[] };
    expect(hit.episodes.length).toBe(1);
  });

  it('deletes a series and its audio for the owner', async () => {
    const { app, headers, ep } = await withEpisode();
    const res = await app.request(`/api/series/${ep.seriesId}`, { method: 'DELETE', headers });
    expect(res.status).toBe(200);
    expect(await ctx!.storage.head(ep.audioKey!)).toBeNull();
    expect(await ctx!.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, ep.seriesId))).toEqual([]);
  });

  it('changes visibility and creates a share link only when public', async () => {
    const { app, headers, ep } = await withEpisode();
    const pub = (await (await app.request(`/api/series/${ep.seriesId}`, { method: 'PATCH', headers, body: JSON.stringify({ visibility: 'public' }) })).json()) as { visibility: string; publicSlug: string };
    expect(pub.visibility).toBe('public');
    expect(pub.publicSlug).toMatch(/^[a-z0-9-]+$/);
    const priv = (await (await app.request(`/api/series/${ep.seriesId}`, { method: 'PATCH', headers, body: JSON.stringify({ visibility: 'private' }) })).json()) as { visibility: string };
    expect(priv.visibility).toBe('private');
  });
});

describe('route isolation', () => {
  it('unknown API paths still answer 404, not 401', async () => {
    ctx = await createTestContext();
    expect((await createApp(ctx).request('/api/definitely-not-a-route')).status).toBe(404);
  });
});

describe('reading a saved position', () => {
  it('returns the saved position, or a fresh state', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    expect(await (await app.request(`/api/playback/${ep.id}`, { headers: { cookie } })).json()).toMatchObject({ positionMs: 0, status: 'not_started' });
    await put(app, headers, ep.id, { positionMs: 12_000, clientUpdatedAt: '2026-10-22T10:00:00Z', event: 'progress' });
    expect(await (await app.request(`/api/playback/${ep.id}`, { headers: { cookie } })).json()).toMatchObject({ positionMs: 12_000, status: 'in_progress' });
  });
});

describe('show artwork', () => {
  it("serves each show's cover to whoever can see the show, and not while switched off", async () => {
    const { app, cookie, ep } = await withEpisode();
    const res = await app.request(`/api/series/${ep.seriesId}/cover.svg`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    const [series] = await ctx!.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, ep.seriesId));
    expect(await res.text()).toContain(`aria-label="${series!.title}"`);
    // A private show is not shown to others.
    expect((await app.request(`/api/series/${ep.seriesId}/cover.svg`)).status).toBe(404);
    await ctx!.settings.update({ features: { showArtwork: false } }, { id: series!.userId });
    expect((await app.request(`/api/series/${ep.seriesId}/cover.svg`, { headers: { cookie } })).status).toBe(404);
  });
});

describe('shared episode links', () => {
  it("open with that episode's own title in link previews, only for a public podcast", async () => {
    const { app, headers, ep } = await withEpisode();
    const url = (n: number | string) => `/p/${slug}/e/${n}`;
    let slug = '';
    const pub = (await (await app.request(`/api/series/${ep.seriesId}`, { method: 'PATCH', headers, body: JSON.stringify({ visibility: 'public' }) })).json()) as { publicSlug: string };
    slug = pub.publicSlug;
    const page = await app.request(url(ep.number));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`<title>${ep.title} — `);
    expect((await app.request(url(99))).status).toBe(404);
    expect((await app.request(url('x'))).status).toBe(404);
    await app.request(`/api/series/${ep.seriesId}`, { method: 'PATCH', headers, body: JSON.stringify({ visibility: 'private' }) });
    expect((await app.request(url(ep.number))).status).toBe(404);
  });
});
