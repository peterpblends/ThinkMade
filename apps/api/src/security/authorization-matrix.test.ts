import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { runNextJob } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

/**
 * Security regression suite: a second account (and an anonymous visitor) tries every route that touches
 * the first account's private data. Nothing may succeed, and nothing may reveal whether the data exists.
 */
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let app: ReturnType<typeof createApp>;
let owner: string;
let intruder: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx);
  owner = await signUpVerified(app, ctx, { email: 'owner@example.com' });
  intruder = await signUpVerified(app, ctx, { email: 'intruder@example.com' });
  const h = { cookie: owner, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  const form = new FormData();
  form.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)])], 'p.png', { type: 'image/png' }));
  ids.upload = ((await (await app.request('/api/uploads', { method: 'POST', headers: { cookie: owner, origin: ctx.env.APP_URL }, body: form })).json()) as { id: string }).id;
  ids.job = (
    (await (
      await app.request('/api/generations', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ topic: 'Private matter', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }),
      })
    ).json()) as { id: string }
  ).id;
  await runNextJob(ctx.worker!);
  const [job] = await ctx.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, ids.job));
  ids.series = job!.seriesId!;
  const [ep] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, ids.series));
  ids.episode = ep!.id;
  await app.request(`/api/coach/${ids.episode}/messages`, { method: 'POST', headers: h, body: JSON.stringify({ content: 'Private coaching question' }) });
  const [cs] = await ctx.db.select().from(schema.coachingSession);
  ids.coaching = cs!.id;
});
afterAll(() => ctx.close());

const json = (cookie?: string) => ({ ...(cookie ? { cookie } : {}), 'content-type': 'application/json', origin: 'http://localhost:5173' });

const ATTEMPTS: Array<[string, string, (i: Record<string, string>) => string, unknown?]> = [
  ['GET', 'read generation status', (i) => `/api/generations/${i.job}`],
  ['POST', 'cancel the generation', (i) => `/api/generations/${i.job}/cancel`, {}],
  ['POST', 'retry the generation', (i) => `/api/generations/${i.job}/retry`, {}],
  ['GET', 'read the series', (i) => `/api/series/${i.series}`],
  ['PATCH', 'change visibility', (i) => `/api/series/${i.series}`, { visibility: 'public' }],
  ['DELETE', 'delete the series', (i) => `/api/series/${i.series}`],
  ['GET', 'read the episode', (i) => `/api/episodes/${i.episode}`],
  ['GET', 'stream the audio', (i) => `/api/episodes/${i.episode}/audio`],
  ['GET', 'read playback', (i) => `/api/playback/${i.episode}`],
  ['PUT', 'write playback', (i) => `/api/playback/${i.episode}`, { positionMs: 1, event: 'progress', clientUpdatedAt: '2026-10-22T10:00:00Z', deviceId: 'x' }],
  ['PUT', 'favorite it', (i) => `/api/favorites/${i.episode}`, {}],
  ['PUT', 'rate it', (i) => `/api/ratings/${i.episode}`, { stars: 1 }],
  ['PUT', 'save it to a library', (i) => `/api/library/${i.series}`, {}],
  ['GET', 'read coaching history', (i) => `/api/coach/${i.episode}`],
  ['POST', 'use the coach', (i) => `/api/coach/${i.episode}/messages`, { content: 'hi' }],
  ['DELETE', 'delete the upload', (i) => `/api/uploads/${i.upload}`],
];

describe('another signed-in account', () => {
  for (const [method, label, path, body] of ATTEMPTS) {
    it(`cannot ${label}`, async () => {
      const res = await app.request(path(ids), { method, headers: json(intruder), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      expect([403, 404], `${method} ${label} returned ${res.status}`).toContain(res.status);
    });
  }

  it("cannot attach the owner's upload, coaching or series to a new podcast", async () => {
    for (const extra of [{ mediaUploadIds: [ids.upload] }, { coachingSessionId: ids.coaching }, { parentSeriesId: ids.series }]) {
      const res = await app.request('/api/generations', { method: 'POST', headers: json(intruder), body: JSON.stringify({ topic: 'Steal', ...extra }) });
      expect(res.status).toBe(400);
    }
  });

  it("sees none of the owner's data in their library, export or search", async () => {
    const lib = (await (await app.request('/api/library', { headers: json(intruder) })).json()) as { episodes: unknown[] };
    expect(lib.episodes).toEqual([]);
    const exp = await (await app.request('/api/me/export', { headers: json(intruder) })).text();
    expect(exp).not.toContain('Private matter');
    expect(exp).not.toContain('Private coaching question');
    const disc = (await (await app.request('/api/discover?q=private', { headers: json(intruder) })).json()) as { results: unknown[] };
    expect(disc.results).toEqual([]);
  });

  it('the data really exists, so the checks above are meaningful', async () => {
    expect((await app.request(`/api/series/${ids.series}`, { headers: json(owner) })).status).toBe(200);
    expect((await app.request(`/api/coach/${ids.episode}`, { headers: json(owner) })).status).toBe(200);
  });
});

describe('an anonymous visitor', () => {
  for (const [method, label, path, body] of ATTEMPTS) {
    it(`cannot ${label}`, async () => {
      const res = await app.request(path(ids), { method, headers: json(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      expect([401, 403, 404], `${method} ${label} returned ${res.status}`).toContain(res.status);
    });
  }
});

describe('admin routes', () => {
  const ADMIN = ['/api/admin/settings', '/api/admin/usage', '/api/admin/bugs', '/api/admin/models', '/api/admin/prompts', '/api/admin/quality', '/api/admin/public', '/api/admin/audit', '/api/auth/admin/list-users'];
  for (const path of ADMIN) {
    it(`${path} is closed to listeners and visitors`, async () => {
      expect((await app.request(path, { headers: json(intruder) })).status).toBe(403);
      expect([401, 403]).toContain((await app.request(path, { headers: json() })).status);
    });
  }
});
