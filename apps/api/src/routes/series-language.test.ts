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

type Series = {
  title: string;
  language: string;
  originalLanguage: string;
  languages: string[];
  activeGenerationId?: string | null;
  episodes: Array<{ id: string; title: string; audioUrl: string | null; audioLanguage: string; languageStatus: string; hosts: Array<{ name: string }> }>;
};

async function setup(speakerFormat = 'single') {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'lang@example.com' });
  const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  await app.request('/api/generations', { method: 'POST', headers, body: JSON.stringify({ topic: 'Why do projects run late?', customization: { lengthMinutes: 1, episodes: 1, speakerFormat, learningMode: 'explore' } }) });
  await runNextJob(ctx.worker!);
  const [s] = await ctx.db.select().from(schema.podcastSeries);
  const get = async () => (await (await app.request(`/api/series/${s!.id}`, { headers: { cookie } })).json()) as Series;
  const switchTo = (language: string, as = cookie) => app.request(`/api/series/${s!.id}/language`, { method: 'PUT', headers: { ...headers, cookie: as }, body: JSON.stringify({ language }) });
  return { app, cookie, headers, series: s!, get, switchTo };
}

describe('changing a podcast’s language', () => {
  it('shows the new language at once, voices it in the background, and switches back instantly', async () => {
    const { app, cookie, series, get, switchTo } = await setup();
    const before = await get();
    expect(before).toMatchObject({ language: 'en', originalLanguage: 'en', languages: ['en'] });

    const res = await switchTo('es');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ language: 'es', voicing: true });
    const now = await get();
    expect(now.title).toBe(`[Spanish] ${before.title}`);
    expect(now.languages).toEqual(['en', 'es']);
    expect(now.episodes[0]).toMatchObject({ title: `[Spanish] ${before.episodes[0]!.title}`, languageStatus: 'voicing', audioLanguage: 'en', audioUrl: before.episodes[0]!.audioUrl });
    // The voicing runs in the background: it isn't a podcast being made, and doesn't hold the series up.
    expect(now.activeGenerationId).toBeNull();
    const gens = (await (await app.request('/api/generations', { headers: { cookie } })).json()) as { generations: unknown[] };
    expect(gens.generations).toHaveLength(1);

    await runNextJob(ctx!.worker!);
    const voiced = await get();
    expect(voiced.episodes[0]).toMatchObject({ languageStatus: 'ready', audioLanguage: 'es', audioUrl: `/api/episodes/${before.episodes[0]!.id}/audio?lang=es` });
    expect(voiced.episodes[0]!.hosts.map((h) => h.name)).toEqual(before.episodes[0]!.hosts.map((h) => h.name));
    const [t] = await ctx!.db.select().from(schema.episodeTranslation);
    expect(t!.hosts!.every((h) => ['ef_dora', 'em_alex'].includes(h.voice))).toBe(true);
    expect(t!.script!.every((l) => l.text.startsWith('[Spanish] '))).toBe(true);
    const audio = await app.request(voiced.episodes[0]!.audioUrl!, { headers: { cookie } });
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    // The episode's transcript is in Spanish too.
    const detail = (await (await app.request(`/api/episodes/${before.episodes[0]!.id}`, { headers: { cookie } })).json()) as { transcript: string; seriesTitle: string };
    expect(detail.transcript).toContain('[Spanish]');

    // Back to English, and to Spanish again: both instant, nothing new to make.
    expect(await (await switchTo('en')).json()).toEqual({ language: 'en', voicing: false });
    expect((await get()).title).toBe(before.title);
    expect(await (await switchTo('es')).json()).toEqual({ language: 'es', voicing: false });
    expect((await ctx!.db.select().from(schema.generationJob).where(eq(schema.generationJob.seriesId, series.id))).length).toBe(2);
  });

  it('starts the voicing of an episode over when it errors, without translating it again', async () => {
    const { get, switchTo } = await setup();
    await switchTo('es');
    const worker = ctx!.worker!;
    const tts = worker.tts;
    let broke = false;
    worker.tts = {
      ...tts,
      synthesize: async (text, voice, o) => {
        if (!broke) {
          broke = true;
          throw new Error('speech engine crashed');
        }
        return tts.synthesize(text, voice, o);
      },
    };
    let translations = 0;
    const llm = worker.llm;
    worker.llm = async (stage) => {
      const client = await llm(stage);
      return {
        provider: client.provider,
        model: client.model,
        ...(client.requestTokenLimit !== undefined ? { requestTokenLimit: client.requestTokenLimit } : {}),
        chat: async (messages, options) => {
          if (String(messages[0]?.content).startsWith('STAGE: translate')) translations++;
          return client.chat(messages, options);
        },
      };
    };
    await runNextJob(worker);
    expect(broke).toBe(true);
    expect((await get()).episodes[0]).toMatchObject({ languageStatus: 'ready', audioLanguage: 'es' });
    expect(translations).toBe(1);
  });

  it('refuses a language without a voice for every host, unknown languages, and other people', async () => {
    const { app, switchTo } = await setup('two_hosts');
    const fr = await switchTo('fr');
    expect(fr.status).toBe(400);
    expect(await fr.json()).toMatchObject({ error: 'not_enough_voices' });
    expect((await switchTo('tlh')).status).toBe(400);
    const other = await signUpVerified(app, ctx!, { email: 'other@example.com' });
    expect((await switchTo('es', other)).status).toBe(404);
  });
});
