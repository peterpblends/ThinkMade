import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { runNextJob } from '@thinkmade/worker';
import { buildRoutes } from '../../scripts/build-vercel';
import { CONTENT_SECURITY_POLICY } from '../middleware/security-headers';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';
import { withPreviewTags } from './discover';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('review fixes (API)', () => {
  it('lets the browser reach the object store for direct uploads and downloads', () => {
    const csp = buildRoutes('<html></html>', { connectOrigins: ['https://abc.r2.cloudflarestorage.com'] }).find((r) => r.headers?.['Content-Security-Policy'])!.headers!['Content-Security-Policy']!;
    expect(csp).toContain("connect-src 'self' https://abc.r2.cloudflarestorage.com");
    expect(csp).toContain("media-src 'self' blob: https:");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  });

  it('keeps titles literal in share-page preview tags', () => {
    const html = '<title>x</title><meta property="og:title" content="" />';
    const out = withPreviewTags(html, { title: 'Supply $& Demand', description: 'd', url: 'u' });
    expect(out).toContain('<title>Supply $&amp; Demand</title>');
    expect(out).toContain('content="Supply $&amp; Demand"');
  });

  it('shows other people only the ready episodes of a public series', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const owner = await signUpVerified(app, ctx, { email: 'o@example.com' });
    const viewer = await signUpVerified(app, ctx, { email: 'v@example.com' });
    const h = { cookie: owner, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    await app.request('/api/generations', { method: 'POST', headers: h, body: JSON.stringify({ topic: 'Two eps', customization: { lengthMinutes: 1, episodes: 2, speakerFormat: 'single', learningMode: 'explore' } }) });
    await runNextJob(ctx.worker!);
    const [s] = await ctx.db.select().from(schema.podcastSeries);
    await app.request(`/api/series/${s!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ visibility: 'public' }) });
    const eps = await ctx.db.select().from(schema.episode).orderBy(schema.episode.number);
    await ctx.db.update(schema.episode).set({ status: 'needs_review' }).where(eq(schema.episode.id, eps[1]!.id));
    const forViewer = (await (await app.request(`/api/series/${s!.id}`, { headers: { cookie: viewer } })).json()) as { episodes: unknown[] };
    expect(forViewer.episodes).toHaveLength(1);
    const forOwner = (await (await app.request(`/api/series/${s!.id}`, { headers: { cookie: owner } })).json()) as { episodes: unknown[] };
    expect(forOwner.episodes).toHaveLength(2);
  });

  it('making a series public succeeds even if search indexing fails', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const owner = await signUpVerified(app, ctx, { email: 'p@example.com' });
    const h = { cookie: owner, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    await app.request('/api/generations', { method: 'POST', headers: h, body: JSON.stringify({ topic: 'Index me', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    await runNextJob(ctx.worker!);
    const [s] = await ctx.db.select().from(schema.podcastSeries);
    ctx.embedder = async () => ({ name: 'broken', embed: async () => { throw new Error('down'); } });
    const res = await app.request(`/api/series/${s!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ visibility: 'public' }) });
    expect(res.status).toBe(200);
  });

  it('answers 416 for an empty byte range and 400 for a bad audit date', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const owner = await signUpVerified(app, ctx, { email: 'r@example.com' });
    const admin = await signUpVerified(app, ctx, { email: 'a@example.com', role: 'admin', twoFactorEnabled: true });
    await app.request('/api/generations', { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json', origin: ctx.env.APP_URL }, body: JSON.stringify({ topic: 'Ranges', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    await runNextJob(ctx.worker!);
    const [ep] = await ctx.db.select().from(schema.episode);
    expect((await app.request(`/api/episodes/${ep!.id}/audio`, { headers: { cookie: owner, range: 'bytes=-' } })).status).toBe(416);
    expect((await app.request('/api/admin/audit?since=garbage', { headers: { cookie: admin } })).status).toBe(400);
  });
});
