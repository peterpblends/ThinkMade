import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setFakeResponder, textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { fakeResponder, runNextJob } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  setFakeResponder(fakeResponder);
  await ctx?.close();
  ctx = undefined;
});

const ONE = { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' };

async function world() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const alice = await signUpVerified(app, ctx, { email: 'alice@example.com' });
  const bob = await signUpVerified(app, ctx, { email: 'bob@example.com' });
  const h = (cookie: string) => ({ cookie, 'content-type': 'application/json', origin: ctx!.env.APP_URL });
  const make = async (cookie: string, topic: string) => {
    const { id } = (await (await app.request('/api/generations', { method: 'POST', headers: h(cookie), body: JSON.stringify({ topic, customization: ONE }) })).json()) as { id: string };
    await runNextJob(ctx!.worker!);
    const [job] = await ctx!.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, id));
    return job!.seriesId!;
  };
  return { app, alice, bob, h, make };
}

describe('Discover', () => {
  it('finds public podcasts by text and never shows private ones', async () => {
    const { app, alice, bob, h, make } = await world();
    const pub = await make(alice, 'Why do projects run late with bottlenecks?');
    const priv = await make(alice, 'My private worries about bottlenecks');
    await app.request(`/api/series/${pub}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'public' }) });
    const res = (await (await app.request('/api/discover?q=thinking', { headers: { cookie: bob } })).json()) as { results: Array<{ id: string; title: string; models: string[] }> };
    expect(res.results.map((r) => r.id)).toEqual([pub]);
    expect(res.results.map((r) => r.id)).not.toContain(priv);
    // Anonymous visitors can discover too.
    const anon = (await (await app.request('/api/discover')).json()) as { results: Array<{ id: string }> };
    expect(anon.results.map((r) => r.id)).toEqual([pub]);
  });

  it('searches by mental model name and by book author', async () => {
    const { app, alice, h, make } = await world();
    const pub = await make(alice, 'Decisions');
    await app.request(`/api/series/${pub}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'public' }) });
    const [model] = await ctx!.db.select().from(schema.mentalModel).limit(1);
    const byModel = (await (await app.request(`/api/discover?q=${encodeURIComponent(model!.name)}`)).json()) as { results: unknown[] };
    expect(byModel.results).toHaveLength(1);
    const byAuthor = (await (await app.request('/api/discover?q=Ada%20Author')).json()) as { results: unknown[] };
    expect(byAuthor.results).toHaveLength(1);
    const none = (await (await app.request('/api/discover?q=sourdough%20starter')).json()) as { results: unknown[] };
    expect(none.results).toEqual([]);
  });

  it('suggests similar public podcasts before creating, excluding my own and private ones', async () => {
    const { app, alice, bob, h, make } = await world();
    const pub = await make(alice, 'Why do my software projects always run late?');
    await app.request(`/api/series/${pub}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'public' }) });
    const res = (await (await app.request('/api/discover/suggest', { method: 'POST', headers: h(bob), body: JSON.stringify({ topic: 'Why do our software projects run late?' }) })).json()) as { suggestions: Array<{ id: string; similarity: number }> };
    expect(res.suggestions.map((s) => s.id)).toEqual([pub]);
    const mine = (await (await app.request('/api/discover/suggest', { method: 'POST', headers: h(alice), body: JSON.stringify({ topic: 'Why do my software projects always run late?' }) })).json()) as { suggestions: unknown[] };
    expect(mine.suggestions).toEqual([]);
  });

  it('serves a shareable public page with preview tags, and nothing for private series', async () => {
    const { app, alice, h, make } = await world();
    const sid = await make(alice, 'Share me');
    const priv = await ctx!.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, sid));
    const { publicSlug } = (await (await app.request(`/api/series/${sid}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'public' }) })).json()) as { publicSlug: string };
    const page = await app.request(`/p/${publicSlug}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<meta property="og:title" content="${priv[0]!.title} — ThinkMade"`);
    expect(html).toContain('og:description');
    expect(html).not.toContain('Share me'); // the owner's original question is never exposed
    const json = (await (await app.request(`/api/public/${publicSlug}`)).json()) as { id: string; episodes: unknown[] };
    expect(json.id).toBe(sid);
    await app.request(`/api/series/${sid}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'private' }) });
    expect((await app.request(`/api/public/${publicSlug}`)).status).toBe(404);
    expect((await app.request(`/p/${publicSlug}`)).status).toBe(404);
  });

  it('lets others save a public series to their library', async () => {
    const { app, alice, bob, h, make } = await world();
    const sid = await make(alice, 'Save me');
    await app.request(`/api/series/${sid}`, { method: 'PATCH', headers: h(alice), body: JSON.stringify({ visibility: 'public' }) });
    expect((await app.request(`/api/library/${sid}`, { method: 'PUT', headers: h(bob) })).status).toBe(200);
    const lib = (await (await app.request('/api/library', { headers: { cookie: bob } })).json()) as { episodes: Array<{ seriesId: string }> };
    expect(lib.episodes.map((e) => e.seriesId)).toEqual([sid]);
  });
});

describe('Continued learning', () => {
  it('Go Deeper focuses on the parent series models', async () => {
    const { app, alice, h, make } = await world();
    const parent = await make(alice, 'Bottlenecks');
    let selectInput = '';
    setFakeResponder((m: ChatMessage[]) => {
      if (textOf(m[0]!.content).startsWith('STAGE: select_models')) selectInput = textOf(m[1]!.content);
      return fakeResponder(m);
    });
    const res = await app.request('/api/generations', { method: 'POST', headers: h(alice), body: JSON.stringify({ topic: '', parentSeriesId: parent, customization: { ...ONE, learningMode: 'deepen' } }) });
    expect(res.status).toBe(202);
    await runNextJob(ctx!.worker!);
    const [ep] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.seriesId, parent));
    const [m] = await ctx!.db.select().from(schema.mentalModel).where(eq(schema.mentalModel.id, ep!.primaryMentalModelId!));
    expect(selectInput).toContain('"focusModels"');
    expect(selectInput).toContain(m!.slug);
  });

  it('Reinforce asks for different books than before', async () => {
    const { app, alice, h, make } = await world();
    const parent = await make(alice, 'Bottlenecks again');
    let researchInput = '';
    setFakeResponder((m: ChatMessage[]) => {
      if (textOf(m[0]!.content).startsWith('STAGE: research')) researchInput = textOf(m[1]!.content);
      return fakeResponder(m);
    });
    await app.request('/api/generations', { method: 'POST', headers: h(alice), body: JSON.stringify({ topic: '', parentSeriesId: parent, customization: { ...ONE, learningMode: 'reinforce' } }) });
    await runNextJob(ctx!.worker!);
    expect(researchInput).toContain('"avoidBooks"');
    expect(researchInput).toContain('The Book of');
  });

  it("refuses to continue from someone else's private series", async () => {
    const { app, alice, bob, h, make } = await world();
    const parent = await make(alice, 'Mine');
    const res = await app.request('/api/generations', { method: 'POST', headers: h(bob), body: JSON.stringify({ topic: '', parentSeriesId: parent }) });
    expect(res.status).toBe(400);
  });

  it('a topic update asks for newer material', async () => {
    const { app, alice, h, make } = await world();
    const parent = await make(alice, 'Update me');
    let researchInput = '';
    setFakeResponder((m: ChatMessage[]) => {
      if (textOf(m[0]!.content).startsWith('STAGE: research')) researchInput = textOf(m[1]!.content);
      return fakeResponder(m);
    });
    const res = await app.request('/api/generations', { method: 'POST', headers: h(alice), body: JSON.stringify({ topic: '', parentSeriesId: parent, update: true, customization: ONE }) });
    expect(res.status).toBe(202);
    await runNextJob(ctx!.worker!);
    expect(researchInput).toContain('"publishedAfterYear"');
    const series = await ctx!.db.select().from(schema.podcastSeries);
    expect(series).toHaveLength(2); // the original is preserved
  });
});
