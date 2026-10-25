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

async function setup() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'gen@example.com' });
  const json = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  return { app, cookie, json };
}

describe('generations', () => {
  it('requires a session', async () => {
    ctx = await createTestContext();
    const res = await createApp(ctx).request('/api/generations', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
  });

  it('creates a job with admin defaults when the user only gives a topic', async () => {
    const { app, json } = await setup();
    const res = await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'How can I become a better leader?' }) });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    const [job] = await ctx!.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, id));
    expect(job!.options).toMatchObject({ lengthMinutes: 15, episodes: 3, speakerFormat: 'mixed', learningMode: 'explore', visibility: 'private' });
  });

  it('applies customisation but never beyond admin maximums', async () => {
    const { app, json } = await setup();
    await ctx!.settings.update({ podcast: { maxEpisodeMinutes: 30, defaultLengthMinutes: 15, maxEpisodesPerSeries: 5 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ topic: 'Bottlenecks', customization: { lengthMinutes: 60, episodes: 10, speakerFormat: 'two_hosts', learningMode: 'deepen' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'exceeds_limits' });
  });

  it('enforces the daily generation limit', async () => {
    const { app, json } = await setup();
    await ctx!.settings.update({ limits: { perUserDailyJobs: 1 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    const body = JSON.stringify({ topic: 'One topic please' });
    expect((await app.request('/api/generations', { method: 'POST', headers: json, body })).status).toBe(202);
    const second = await app.request('/api/generations', { method: 'POST', headers: json, body });
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: 'daily_limit' });
  });

  it('reports real progress, then the finished series with playable audio', async () => {
    const { app, json, cookie } = await setup();
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ topic: 'Why do people resist change?', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }),
    });
    const { id } = (await res.json()) as { id: string };

    const before = (await (await app.request(`/api/generations/${id}`, { headers: { cookie } })).json()) as Record<string, unknown>;
    expect(before).toMatchObject({ status: 'queued', label: 'Understanding your topic' });
    expect(before.steps).toEqual([
      { label: 'Understanding your topic', state: 'pending' },
      { label: 'Connecting relevant thinking', state: 'pending' },
      { label: 'Building your podcasts', state: 'pending' },
      { label: 'Preparing the audio', state: 'pending' },
    ]);

    await runNextJob(ctx!.worker!);
    const after = (await (await app.request(`/api/generations/${id}`, { headers: { cookie } })).json()) as { status: string; label: string; seriesId: string; steps: Array<{ state: string }> };
    expect(after.status).toBe('succeeded');
    expect(after.label).toBe('Ready to listen');
    expect(after.steps.every((s) => s.state === 'done')).toBe(true);

    const series = (await (await app.request(`/api/series/${after.seriesId}`, { headers: { cookie } })).json()) as {
      title: string; episodes: Array<{ id: string; status: string; primaryModel: { name: string }; durationSeconds: number; sources: unknown[] }>;
    };
    expect(series.episodes).toHaveLength(1);
    const ep = series.episodes[0]!;
    expect(ep.status).toBe('ready');
    expect(ep.primaryModel.name).toBeTruthy();
    expect(ep.sources.length).toBeGreaterThan(0);

    const full = await app.request(`/api/episodes/${ep.id}/audio`, { headers: { cookie } });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const size = Number(full.headers.get('content-length'));
    expect(size).toBeGreaterThan(1000);

    const part = await app.request(`/api/episodes/${ep.id}/audio`, { headers: { cookie, range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${size}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  it("never shows another user's private series, episode or audio", async () => {
    const { app, json, cookie } = await setup();
    const res = await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'Private thoughts', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    const { id } = (await res.json()) as { id: string };
    await runNextJob(ctx!.worker!);
    const { seriesId } = (await (await app.request(`/api/generations/${id}`, { headers: { cookie } })).json()) as { seriesId: string };
    const [ep] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));

    const other = await signUpVerified(app, ctx!, { email: 'snoop@example.com' });
    for (const path of [`/api/generations/${id}`, `/api/series/${seriesId}`, `/api/episodes/${ep!.id}`, `/api/episodes/${ep!.id}/audio`]) {
      expect((await app.request(path, { headers: { cookie: other } })).status, path).toBe(404);
      // Anonymous callers get 401 or 404; neither reveals whether the resource exists.
      expect([401, 404], `${path} anonymous`).toContain((await app.request(path)).status);
    }
  });

  it('lets the owner cancel a queued job', async () => {
    const { app, json, cookie } = await setup();
    const { id } = (await (await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'Cancel this one' }) })).json()) as { id: string };
    expect((await app.request(`/api/generations/${id}/cancel`, { method: 'POST', headers: json })).status).toBe(200);
    await runNextJob(ctx!.worker!);
    const res = (await (await app.request(`/api/generations/${id}`, { headers: { cookie } })).json()) as { status: string };
    expect(res.status).toBe('cancelled');
  });

  it('lists my series newest first', async () => {
    const { app, json, cookie } = await setup();
    await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'Listing test', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    await runNextJob(ctx!.worker!);
    const list = (await (await app.request('/api/series', { headers: { cookie } })).json()) as { series: Array<{ title: string; episodeCount: number; readyCount: number }> };
    expect(list.series).toHaveLength(1);
    expect(list.series[0], JSON.stringify(list.series[0])).toMatchObject({ episodeCount: 1, readyCount: 1 });
  });
});

describe('voice transcription', () => {
  it('returns the transcript for a short recording', async () => {
    const { app, cookie } = await setup();
    const form = new FormData();
    form.set('audio', new File([new Uint8Array(2000)], 'clip.webm', { type: 'audio/webm' }));
    const res = await app.request('/api/transcribe', { method: 'POST', headers: { cookie, origin: ctx!.env.APP_URL }, body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'How can I become a better leader?' });
  });

  it('rejects non-audio uploads', async () => {
    const { app, cookie } = await setup();
    const form = new FormData();
    form.set('audio', new File([new Uint8Array(10)], 'x.exe', { type: 'application/octet-stream' }));
    expect((await app.request('/api/transcribe', { method: 'POST', headers: { cookie }, body: form })).status).toBe(415);
  });
});

describe('progress steps', () => {
  it('ticks a step whose optional stage never ran once a later step has started', async () => {
    const { steps } = await import('./generation');
    const s = steps('running', 'plan', new Set(['understand', 'select_models', 'research']));
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'active', 'pending']);
  });
});
