import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LlmError, setFakeResponder, textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { fakeResponder, runNextJob, setFakeValidation } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  setFakeResponder(fakeResponder);
  setFakeValidation(() => ({ scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5 }, passed: true, problems: [], sectionsToRevise: [], revisionNotes: '' }));
  await ctx?.close();
  ctx = undefined;
});

const ONE = { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' };

async function admin() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'root@example.com', role: 'admin', twoFactorEnabled: true });
  const user = await signUpVerified(app, ctx, { email: 'user@example.com' });
  const h = (c: string) => ({ cookie: c, 'content-type': 'application/json', origin: ctx!.env.APP_URL });
  return { app, cookie, user, h };
}

describe('bug reports', () => {
  it('saves a report with privacy-safe diagnostics and emails the configured address', async () => {
    const { app, cookie, user, h } = await admin();
    await ctx!.settings.update({ bugReports: { email: 'bugs@zicaworld.com' } }, { id: (await ctx!.db.select().from(schema.user).where(eq(schema.user.email, 'root@example.com')))[0]!.id });
    const form = new FormData();
    form.set('description', 'The play button does nothing on my phone');
    form.set('diagnostics', JSON.stringify({ appVersion: 'abc123', userAgent: 'Mozilla/5.0', path: '/series/123?token=secret', viewport: '390x844', password: 'hunter2', cookie: 'x', errorIds: ['E1'] }));
    form.set('screenshot', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(50).fill(0)])], 's.png', { type: 'image/png' }));
    const res = await app.request('/api/bug-reports', { method: 'POST', headers: { cookie: user, origin: ctx!.env.APP_URL }, body: form });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ emailed: true });
    const [bug] = await ctx!.db.select().from(schema.bugReport);
    expect(bug!.status).toBe('new');
    expect(bug!.diagnostics).toEqual({ appVersion: 'abc123', userAgent: 'Mozilla/5.0', path: '/series/123', viewport: '390x844', errorIds: ['E1'] });
    expect(JSON.stringify(bug!.diagnostics)).not.toMatch(/hunter2|secret|cookie/);
    expect(bug!.screenshotKey).toBeTruthy();
    expect(ctx!.email.sent.find((m) => m.to === 'bugs@zicaworld.com')?.text).toContain('The play button does nothing');
    const [delivery] = await ctx!.db.select().from(schema.emailDelivery).where(eq(schema.emailDelivery.kind, 'bug_report'));
    expect(delivery!.status).toBe('sent');

    const list = (await (await app.request('/api/admin/bugs', { headers: { cookie } })).json()) as { bugs: Array<{ id: string }> };
    expect(list.bugs).toHaveLength(1);
    const upd = await app.request(`/api/admin/bugs/${bug!.id}`, { method: 'PATCH', headers: h(cookie), body: JSON.stringify({ status: 'in_progress' }) });
    expect(await upd.json()).toMatchObject({ status: 'in_progress' });
  });

  it('reports honestly when the notification email fails', async () => {
    const { app } = await admin();
    await ctx!.settings.update({ bugReports: { email: 'bugs@zicaworld.com' } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    const original = ctx!.email.send;
    ctx!.email.send = async () => ({ ok: false, error: 'provider down' });
    const res = await app.request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json', origin: ctx!.env.APP_URL }, body: JSON.stringify({ description: 'Anonymous report here' }) });
    ctx!.email.send = original;
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ emailed: false });
    const [d] = await ctx!.db.select().from(schema.emailDelivery).where(eq(schema.emailDelivery.kind, 'bug_report'));
    expect(d).toMatchObject({ status: 'failed', error: 'provider down' });
  });

  it('ignores bots that fill the hidden field and rejects empty reports', async () => {
    const { app } = await admin();
    const bot = await app.request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'spam spam', website: 'http://spam' }) });
    expect(bot.status).toBe(201);
    expect(await ctx!.db.select().from(schema.bugReport)).toHaveLength(0);
    expect((await app.request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: '' }) })).status).toBe(400);
  });

  it('groups recurring problems', async () => {
    const { app, cookie } = await admin();
    for (let i = 0; i < 3; i++) {
      await app.request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: `The download button fails on iPhone ${i}` }) });
    }
    const res = (await (await app.request('/api/admin/bugs/recurring', { headers: { cookie } })).json()) as { groups: Array<{ count: number }> };
    expect(res.groups[0]!.count).toBe(3);
  });

  it('keeps bug reports admin-only', async () => {
    const { app, user } = await admin();
    expect((await app.request('/api/admin/bugs', { headers: { cookie: user } })).status).toBe(403);
  });
});

describe('AI model and prompt administration', () => {
  it('lists, changes and tests the model for a stage, with an audit entry', async () => {
    const { app, cookie, h } = await admin();
    const models = (await (await app.request('/api/admin/models', { headers: { cookie } })).json()) as { stages: Array<{ stage: string; provider: string }> };
    expect(models.stages.map((s) => s.stage)).toContain('script');
    // A setting that can't answer is refused, with the reason, and nothing changes.
    const refused = await app.request('/api/admin/models/script', { method: 'PUT', headers: h(cookie), body: JSON.stringify({ provider: 'groq', model: 'openai/gpt-oss-120b' }) });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: 'test_failed', message: expect.stringMatching(/GROQ_API_KEY/) });
    // "Save anyway" keeps it.
    const put = await app.request('/api/admin/models/script', { method: 'PUT', headers: h(cookie), body: JSON.stringify({ provider: 'groq', model: 'openai/gpt-oss-120b', force: true }) });
    expect(await put.json()).toMatchObject({ stage: 'script', provider: 'groq', model: 'openai/gpt-oss-120b' });
    const test = (await (await app.request('/api/admin/models/script/test', { method: 'POST', headers: h(cookie), body: '{}' })).json()) as { ok: boolean; error?: string };
    expect(test).toMatchObject({ ok: false, error: expect.stringMatching(/GROQ_API_KEY/) });
    const audits = await ctx!.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'model.update'));
    expect(audits).toHaveLength(1);
    // A working setting saves straight away.
    const ok = await app.request('/api/admin/models/script', { method: 'PUT', headers: h(cookie), body: JSON.stringify({ provider: 'fake', model: 'fake' }) });
    expect(ok.status).toBe(200);
  });

  it('explains that the recommended search embedder runs on the worker, rather than reporting a failure', async () => {
    process.env.VERCEL = '1';
    try {
      const { app, cookie, h } = await admin();
      await app.request('/api/admin/models/embed/reset', { method: 'POST', headers: h(cookie), body: '{}' });
      const test = (await (await app.request('/api/admin/models/embed/test', { method: 'POST', headers: h(cookie), body: '{}' })).json()) as { ok: boolean; sample?: string };
      expect(test).toMatchObject({ ok: true, sample: expect.stringMatching(/runs on the podcast worker/i) });
    } finally {
      delete process.env.VERCEL;
    }
  });

  it('shows the recommended model for each stage and puts a stage back on it', async () => {
    const { app, cookie, h } = await admin();
    await app.request('/api/admin/models/vision', { method: 'PUT', headers: h(cookie), body: JSON.stringify({ provider: 'groq', model: 'gemma-4-31b-it:free', force: true }) });
    type Row = { stage: string; provider: string; model: string; custom: boolean; recommended: { provider: string; model: string } };
    const before = ((await (await app.request('/api/admin/models', { headers: { cookie } })).json()) as { stages: Row[] }).stages.find((s) => s.stage === 'vision')!;
    expect(before).toMatchObject({ provider: 'groq', custom: true, recommended: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' } });
    // Even the mistaken setting keeps the recommended model and its backups behind it; missing keys are shown.
    const backups = (before as Row & { backups: Array<{ provider: string; model: string; ready: boolean; keyVar: string | null }> }).backups;
    expect(backups[0]).toMatchObject({ provider: 'openrouter', model: 'google/gemma-4-31b-it:free' });
    expect(backups).toContainEqual({ provider: 'gemini', model: 'gemini-flash-latest', ready: !!process.env.GEMINI_API_KEY, keyVar: 'GEMINI_API_KEY' });
    expect((await app.request('/api/admin/models/vision/reset', { method: 'POST', headers: h(cookie), body: '{}' })).status).toBe(200);
    const after = ((await (await app.request('/api/admin/models', { headers: { cookie } })).json()) as { stages: Row[] }).stages.find((s) => s.stage === 'vision')!;
    expect(after).toMatchObject({ provider: 'openrouter', model: 'google/gemma-4-31b-it:free', custom: false });
    // Its free backups come back too.
    const [row] = await ctx!.db.select().from(schema.aiModelConfig).where(eq(schema.aiModelConfig.stage, 'vision'));
    expect((row!.params as { tm_fallbacks?: unknown[] }).tm_fallbacks?.length).toBeGreaterThan(0);
    expect(await ctx!.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'model.reset'))).toHaveLength(1);
  });

  it('creates a prompt draft, tests it on sample input, activates it, and the worker uses it', async () => {
    const { app, cookie, h } = await admin();
    const draft = (await (await app.request('/api/admin/prompts/understand', { method: 'POST', headers: h(cookie), body: JSON.stringify({ task: 'Custom understanding task. Shape: {"objective": string, "seriesTitle": string, "seriesDescription": string}', note: 'try' }) })).json()) as { version: number };
    expect(draft.version).toBe(1);
    const tested = (await (await app.request('/api/admin/prompts/understand/1/test', { method: 'POST', headers: h(cookie), body: JSON.stringify({ input: { question: 'How do I focus?' } }) })).json()) as { valid: boolean; output: string };
    expect(tested.valid).toBe(true);
    await app.request('/api/admin/prompts/understand/1/activate', { method: 'POST', headers: h(cookie), body: '{}' });

    let system = '';
    setFakeResponder((m: ChatMessage[]) => {
      if (textOf(m[0]!.content).startsWith('STAGE: understand')) system = textOf(m[0]!.content);
      return fakeResponder(m);
    });
    await app.request('/api/generations', { method: 'POST', headers: h(cookie), body: JSON.stringify({ topic: 'Focus please', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    expect(system).toContain('Custom understanding task.');

    await app.request('/api/admin/prompts/understand/reset', { method: 'POST', headers: h(cookie), body: '{}' });
    const list = (await (await app.request('/api/admin/prompts/understand', { headers: { cookie } })).json()) as { active: number | null; defaultTask: string };
    expect(list.active).toBeNull();
    expect(list.defaultTask).toContain('Work out what the person is really trying');
  });
});

describe('quality review queue', () => {
  it('lets an admin record a held script after human review', async () => {
    const { app, cookie, h } = await admin();
    setFakeValidation(() => ({ scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 2, sources: 5, repetition: 5 }, passed: false, problems: ['Unsupported claim'], sectionsToRevise: [1], revisionNotes: 'fix' }));
    await app.request('/api/generations', { method: 'POST', headers: h(cookie), body: JSON.stringify({ topic: 'Held for review', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    const queue = (await (await app.request('/api/admin/quality', { headers: { cookie } })).json()) as { held: Array<{ id: string; notes: string[] }> };
    expect(queue.held).toHaveLength(1);
    expect(queue.held[0]!.notes.join(' ')).toContain('Unsupported claim');
    const res = await app.request(`/api/admin/quality/${queue.held[0]!.id}`, { method: 'POST', headers: h(cookie), body: JSON.stringify({ decision: 'approve', note: 'Checked the claim; it is fine.' }) });
    expect(res.status).toBe(200);
    await runNextJob(ctx!.worker!);
    const [ep] = await ctx!.db.select().from(schema.episode).where(eq(schema.episode.id, queue.held[0]!.id));
    expect(ep!.status).toBe('ready');
    const human = await ctx!.db.select().from(schema.episodeQualityCheck).where(eq(schema.episodeQualityCheck.checkedBy, 'human'));
    expect(human).toHaveLength(1);
  });

  it('records periodic human spot-checks of published episodes', async () => {
    const { app, cookie, h } = await admin();
    await app.request('/api/generations', { method: 'POST', headers: h(cookie), body: JSON.stringify({ topic: 'Spot check', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    const recent = (await (await app.request('/api/admin/quality?scope=recent', { headers: { cookie } })).json()) as { recent: Array<{ id: string }> };
    expect(recent.recent).toHaveLength(1);
    const res = await app.request(`/api/admin/quality/${recent.recent[0]!.id}/review`, { method: 'POST', headers: h(cookie), body: JSON.stringify({ score: 4, note: 'Good, a bit long.' }) });
    expect(res.status).toBe(200);
  });
});

describe('usage dashboard, moderation and audit', () => {
  it('summarises usage and warns before free-tier limits', async () => {
    const { app, cookie, h } = await admin();
    await app.request('/api/generations', { method: 'POST', headers: h(cookie), body: JSON.stringify({ topic: 'Usage', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    await ctx!.settings.update({ alerts: { dailyLlmTokens: 1 } }, { id: (await ctx!.db.select().from(schema.user))[0]!.id });
    await ctx!.db.insert(schema.usageMetric).values({ metric: 'llm_tokens', value: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose shape for assertions
    const u = (await (await app.request('/api/admin/usage', { headers: { cookie } })).json()) as Record<string, any>;
    expect(u.users.total).toBe(2);
    expect(u.generations.last30Days.succeeded).toBe(1);
    expect(u.storage.audioBytes).toBeGreaterThan(0);
    expect(u.quality.firstPassRate).toBeGreaterThanOrEqual(0);
    expect(u.costs.estimatedMonthlyUsd).toBe(0);
    expect(u.alerts).toContainEqual(expect.objectContaining({ key: 'dailyLlmTokens', level: 'over' }));
    expect(u.bandwidth.measured).toBe(false);
  });

  it('reports what each person generated, what went wrong and what they rated', async () => {
    const { app, cookie, user, h } = await admin();
    await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'How do habits form?', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    const [ep] = await ctx!.db.select().from(schema.episode);
    expect((await app.request(`/api/ratings/${ep!.id}`, { method: 'PUT', headers: h(user), body: JSON.stringify({ stars: 4 }) })).status).toBe(200);
    const [u] = await ctx!.db.select().from(schema.user).where(eq(schema.user.email, 'user@example.com'));
    const [req] = await ctx!.db.insert(schema.learningRequest).values({ userId: u!.id, inputText: 'Broken topic' }).returning();
    await ctx!.db.insert(schema.generationJob).values({ userId: u!.id, learningRequestId: req!.id, status: 'failed', currentStage: 'script', error: 'The language model service failed repeatedly.' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose shape for assertions
    const r = (await (await app.request('/api/admin/report?days=30', { headers: { cookie } })).json()) as Record<string, any>;
    expect(r.totals).toMatchObject({ people: 1, requests: 2, episodes: 1, errors: 1, ratings: 1, averageStars: 4 });
    const person = r.people.find((p: { email: string }) => p.email === 'user@example.com');
    expect(person).toMatchObject({ requests: 2, series: 1, episodes: 1, failed: 1, ratings: 1, averageStars: 4 });
    expect(r.generation.map((g: { topic: string; status: string }) => [g.topic, g.status])).toEqual(
      expect.arrayContaining([['How do habits form?', 'succeeded'], ['Broken topic', 'failed']]),
    );
    expect(r.errors).toEqual([expect.objectContaining({ email: 'user@example.com', topic: 'Broken topic', stage: 'script', error: 'The language model service failed repeatedly.' })]);
    expect(r.ratings).toEqual([expect.objectContaining({ email: 'user@example.com', episodeId: ep!.id, stars: 4 })]);

    expect((await app.request('/api/admin/report?days=12', { headers: { cookie } })).status).toBe(400);
    expect((await app.request('/api/admin/report', { headers: { cookie: user } })).status).toBe(403);
  });

  it('lets an admin restart a podcast that errored out, which then finishes for its owner', async () => {
    const { app, cookie, user, h } = await admin();
    setFakeResponder(() => {
      throw new LlmError('groq returned 401: Invalid API Key', 401);
    });
    const created = (await (await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'Why do we procrastinate?', customization: ONE }) })).json()) as { id: string };
    await runNextJob(ctx!.worker!);
    const t = schema.generationJob;
    expect((await ctx!.db.select().from(t).where(eq(t.id, created.id)))[0]!.status).toBe('failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose shape for assertions
    const before = (await (await app.request('/api/admin/report', { headers: { cookie } })).json()) as Record<string, any>;
    expect(before.errors).toEqual([expect.objectContaining({ jobId: created.id, status: 'failed' })]);

    expect((await app.request(`/api/admin/generations/${created.id}/restart`, { method: 'POST', headers: h(user) })).status).toBe(403);
    setFakeResponder(fakeResponder);
    const res = await app.request(`/api/admin/generations/${created.id}/restart`, { method: 'POST', headers: h(cookie) });
    expect(res.status).toBe(202);
    expect((await ctx!.db.select().from(t).where(eq(t.id, created.id)))[0]).toMatchObject({ status: 'queued', error: null, attempts: 0 });
    // Only once: it is in the queue now.
    expect((await app.request(`/api/admin/generations/${created.id}/restart`, { method: 'POST', headers: h(cookie) })).status).toBe(409);
    const [entry] = await ctx!.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'generation.restart'));
    expect(entry).toMatchObject({ targetId: created.id, before: expect.objectContaining({ status: 'failed' }) });

    await runNextJob(ctx!.worker!);
    const [done] = await ctx!.db.select().from(t).where(eq(t.id, created.id));
    expect(done!.status).toBe('succeeded');
    const [series] = await ctx!.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, done!.seriesId!));
    expect(series!.status).toBe('ready');
    // A finished podcast has nothing to restart.
    expect((await app.request(`/api/admin/generations/${created.id}/restart`, { method: 'POST', headers: h(cookie) })).status).toBe(409);
    expect((await app.request('/api/admin/generations/nope/restart', { method: 'POST', headers: h(cookie) })).status).toBe(404);
  });

  it('lets an admin unpublish a public series, with an audit trail', async () => {
    const { app, cookie, user, h } = await admin();
    await app.request('/api/generations', { method: 'POST', headers: h(user), body: JSON.stringify({ topic: 'Public thing', customization: ONE }) });
    await runNextJob(ctx!.worker!);
    const [s] = await ctx!.db.select().from(schema.podcastSeries);
    await app.request(`/api/series/${s!.id}`, { method: 'PATCH', headers: h(user), body: JSON.stringify({ visibility: 'public' }) });
    const list = (await (await app.request('/api/admin/public', { headers: { cookie } })).json()) as { series: Array<{ id: string }> };
    expect(list.series.map((x) => x.id)).toEqual([s!.id]);
    expect((await app.request(`/api/admin/public/${s!.id}/unpublish`, { method: 'POST', headers: h(cookie), body: JSON.stringify({ reason: 'Inaccurate' }) })).status).toBe(200);
    const [after] = await ctx!.db.select().from(schema.podcastSeries);
    expect(after!.visibility).toBe('private');
    const audit = (await (await app.request('/api/admin/audit?action=series.unpublish', { headers: { cookie } })).json()) as { entries: Array<{ action: string; after: unknown }> };
    expect(audit.entries[0]).toMatchObject({ action: 'series.unpublish', after: { visibility: 'private', reason: 'Inaccurate' } });
  });
});
