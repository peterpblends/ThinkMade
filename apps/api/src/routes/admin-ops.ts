import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { completeJson, EmbedderUnavailableError, LLM_PROVIDERS, providerConfigured, providerKeyVar, textOf } from '@thinkmade/ai';
import { defaultStageModel, MODEL_STAGES, queryRows, schema, withRecommendedFallbacks, type ModelStage } from '@thinkmade/db';
import { DEFAULT_PROMPTS, input, PROMPT_STAGES, stageSystem, STAGE_SCHEMAS, type PromptStage } from '@thinkmade/shared';
import type { AppContext } from '../create-context';
import { restartJob } from '../generation/restart';
import { RegenerateError, regenerateSeries } from '../generation/regenerate';
import { clientIp } from '../middleware/rate-limit';
import type { AppVariables } from '../middleware/session';

const BUG_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
const EMBED_PROVIDERS = ['local', 'hash', 'gemini', 'ollama', 'openrouter'];

function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(' ');
}

/** Mounted under /api/admin (admin role + two-step verification required). */
export function adminOpsRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  const actor = (c: { var: AppVariables; req: { header: (h: string) => string | undefined } }) => ({ id: c.var.session!.user.id, ip: clientIp(c as never) });
  const audit = async (actorId: string, ip: string, action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) =>
    ctx.db.insert(schema.auditLog).values({ actorId, action, targetType, targetId, before: before as never, after: after as never, ip });

  // ---------- Bug reports ----------
  r.get('/bugs', async (c) => {
    const status = c.req.query('status');
    const q = c.req.query('q')?.trim();
    const rows = await ctx.db
      .select({ id: schema.bugReport.id, description: schema.bugReport.description, status: schema.bugReport.status, createdAt: schema.bugReport.createdAt, diagnostics: schema.bugReport.diagnostics, hasScreenshot: sql<boolean>`${schema.bugReport.screenshotKey} is not null`, reporter: schema.user.email })
      .from(schema.bugReport)
      .leftJoin(schema.user, eq(schema.user.id, schema.bugReport.userId))
      .where(
        and(
          status && (BUG_STATUSES as readonly string[]).includes(status) ? eq(schema.bugReport.status, status) : undefined,
          q ? sql`${schema.bugReport.description} ilike ${`%${q}%`}` : undefined,
        ),
      )
      .orderBy(desc(schema.bugReport.createdAt))
      .limit(200);
    return c.json({ bugs: rows });
  });

  r.get('/bugs/recurring', async (c) => {
    const rows = await ctx.db.select({ id: schema.bugReport.id, description: schema.bugReport.description, status: schema.bugReport.status }).from(schema.bugReport).where(inArray(schema.bugReport.status, ['new', 'in_progress']));
    const groups = new Map<string, { key: string; count: number; example: string; ids: string[] }>();
    for (const b of rows) {
      const key = fingerprint(b.description);
      const g = groups.get(key) ?? { key, count: 0, example: b.description, ids: [] };
      g.count++;
      g.ids.push(b.id);
      groups.set(key, g);
    }
    return c.json({ groups: [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count) });
  });

  r.get('/bugs/:id/screenshot', async (c) => {
    const [b] = await ctx.db.select().from(schema.bugReport).where(eq(schema.bugReport.id, c.req.param('id')));
    if (!b?.screenshotKey) return c.json({ error: 'not_found' }, 404);
    const obj = await ctx.storage.get(b.screenshotKey);
    const { Readable } = await import('node:stream');
    return new Response(Readable.toWeb(obj.stream) as ReadableStream, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'private, no-store' } });
  });

  r.patch('/bugs/:id', async (c) => {
    const body = z.strictObject({ status: z.enum(BUG_STATUSES) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    const [before] = await ctx.db.select().from(schema.bugReport).where(eq(schema.bugReport.id, c.req.param('id')));
    if (!before) return c.json({ error: 'not_found' }, 404);
    await ctx.db.update(schema.bugReport).set({ status: body.data.status }).where(eq(schema.bugReport.id, before.id));
    const a = actor(c);
    await audit(a.id, a.ip, 'bug.status', 'bug_report', before.id, { status: before.status }, { status: body.data.status });
    return c.json({ id: before.id, status: body.data.status });
  });

  // ---------- AI models ----------
  /**
   * One tiny request to a model, reported honestly. The recommended search embedder runs on the podcast worker,
   * so on a server without it the test says so instead of reporting a failure.
   */
  const checkModel = async (stage: ModelStage, cfg: { provider: string; model: string; params?: Record<string, unknown> }) => {
    const t0 = Date.now();
    try {
      if (stage === 'embed') {
        const [v] = await ctx.embedderFor(cfg).embed(['ThinkMade connection test']);
        return { ok: !!v, latencyMs: Date.now() - t0, sample: `vector of ${v?.length ?? 0} numbers` };
      }
      const res = await ctx.llmFor(cfg).chat([{ role: 'user', content: 'Reply with exactly: ok' }], { maxTokens: 10, temperature: 0 });
      return { ok: true, latencyMs: Date.now() - t0, sample: res.content.slice(0, 200) };
    } catch (err) {
      if (stage === 'embed' && cfg.provider === 'local' && err instanceof EmbedderUnavailableError) {
        return {
          ok: true,
          latencyMs: Date.now() - t0,
          sample: 'Runs on the podcast worker, which indexes public series. Search on this site uses text matching until an embedding server is connected (see docs/worker.md).',
        };
      }
      return { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
    }
  };

  r.get('/models', async (c) => {
    const rows = await ctx.db.select().from(schema.aiModelConfig);
    return c.json({
      stages: MODEL_STAGES.map((stage) => {
        const row = rows.find((x) => x.stage === stage);
        const rec = defaultStageModel(stage, null);
        // What this stage switches to when its model is busy or out of allowance, and whether each is ready.
        const chain = stage === 'embed' ? [] : ((withRecommendedFallbacks(stage, { provider: row?.provider ?? rec.provider, model: row?.model ?? rec.model, params: row?.params ?? rec.params }).params.tm_fallbacks as Array<{ provider: string; model: string }>) ?? []);
        return {
          backups: chain.map((f) => ({ provider: f.provider, model: f.model, ready: providerConfigured(f.provider, process.env), keyVar: providerKeyVar(f.provider) ?? null })),
          stage,
          provider: row?.provider ?? null,
          model: row?.model ?? null,
          params: row?.params ?? {},
          updatedAt: row?.updatedAt ?? null,
          recommended: { provider: rec.provider, model: rec.model },
          /** An administrator chose this setting (otherwise it follows the recommended one). */
          custom: !!row?.updatedBy,
        };
      }),
      providers: { llm: [...LLM_PROVIDERS, ...(ctx.env.NODE_ENV === 'production' ? [] : ['fake'])], embed: EMBED_PROVIDERS },
    });
  });

  r.put('/models/:stage', async (c) => {
    const stage = c.req.param('stage') as ModelStage;
    if (!(MODEL_STAGES as readonly string[]).includes(stage)) return c.json({ error: 'not_found' }, 404);
    const allowed = stage === 'embed' ? EMBED_PROVIDERS : [...LLM_PROVIDERS, ...(ctx.env.NODE_ENV === 'production' ? [] : ['fake'])];
    const body = z
      .strictObject({
        provider: z.string().refine((p) => allowed.includes(p), 'Unknown provider'),
        model: z.string().trim().min(1).max(200),
        params: z.record(z.string(), z.unknown()).optional(),
        /** Save even though the test request failed. */
        force: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', issues: body.error.issues }, 400);
    // A setting that can't answer a test request would fail every podcast: test it before saving.
    if (!body.data.force) {
      const check = await checkModel(stage, { provider: body.data.provider, model: body.data.model, ...(body.data.params ? { params: body.data.params } : {}) });
      if (!check.ok) return c.json({ error: 'test_failed', message: check.error }, 422);
    }
    const [before] = await ctx.db.select().from(schema.aiModelConfig).where(eq(schema.aiModelConfig.stage, stage));
    // Keep tuned params (such as reasoning effort) when only the model's other details are re-saved.
    const sameModel = before?.provider === body.data.provider && before.model === body.data.model;
    const values = { provider: body.data.provider, model: body.data.model, params: body.data.params ?? (sameModel ? (before.params ?? {}) : {}), updatedBy: c.var.session!.user.id, updatedAt: new Date() };
    await ctx.db.insert(schema.aiModelConfig).values({ stage, ...values }).onConflictDoUpdate({ target: schema.aiModelConfig.stage, set: values });
    const a = actor(c);
    await audit(a.id, a.ip, 'model.update', 'ai_model_config', stage, before ? { provider: before.provider, model: before.model } : null, { provider: values.provider, model: values.model });
    return c.json({ stage, provider: values.provider, model: values.model });
  });

  /** Puts a stage back on the recommended free model (with its automatic backups); it then follows future defaults. */
  r.post('/models/:stage/reset', async (c) => {
    const stage = c.req.param('stage') as ModelStage;
    if (!(MODEL_STAGES as readonly string[]).includes(stage)) return c.json({ error: 'not_found' }, 404);
    const [before] = await ctx.db.select().from(schema.aiModelConfig).where(eq(schema.aiModelConfig.stage, stage));
    const rec = defaultStageModel(stage, null);
    const values = { provider: rec.provider, model: rec.model, params: rec.params, updatedBy: null, updatedAt: new Date() };
    await ctx.db.insert(schema.aiModelConfig).values({ stage, ...values }).onConflictDoUpdate({ target: schema.aiModelConfig.stage, set: values });
    const a = actor(c);
    await audit(a.id, a.ip, 'model.reset', 'ai_model_config', stage, before ? { provider: before.provider, model: before.model } : null, { provider: rec.provider, model: rec.model });
    return c.json({ stage, provider: rec.provider, model: rec.model });
  });

  /** Tests the stage's saved model: one tiny request, reported honestly. */
  r.post('/models/:stage/test', async (c) => {
    const stage = c.req.param('stage') as ModelStage;
    if (!(MODEL_STAGES as readonly string[]).includes(stage)) return c.json({ error: 'not_found' }, 404);
    const [row] = await ctx.db.select().from(schema.aiModelConfig).where(eq(schema.aiModelConfig.stage, stage));
    return c.json(await checkModel(stage, row ? { provider: row.provider, model: row.model, params: row.params ?? {} } : defaultStageModel(stage, null)));
  });

  // ---------- Prompts ----------
  const isPromptStage = (s: string): s is PromptStage => (PROMPT_STAGES as readonly string[]).includes(s);

  r.get('/prompts', async (c) => {
    const active = await ctx.db.select().from(schema.promptVersion).where(eq(schema.promptVersion.active, true));
    return c.json({ stages: PROMPT_STAGES.map((s) => ({ stage: s, activeVersion: active.find((a) => a.stage === s)?.version ?? null })) });
  });

  r.get('/prompts/:stage', async (c) => {
    const stage = c.req.param('stage');
    if (!isPromptStage(stage)) return c.json({ error: 'not_found' }, 404);
    const versions = await ctx.db.select().from(schema.promptVersion).where(eq(schema.promptVersion.stage, stage)).orderBy(desc(schema.promptVersion.version));
    return c.json({
      stage,
      defaultTask: DEFAULT_PROMPTS[stage],
      active: versions.find((v) => v.active)?.version ?? null,
      versions: versions.map((v) => ({ version: v.version, task: v.systemPrompt, active: v.active, note: v.note, createdAt: v.createdAt })),
    });
  });

  r.post('/prompts/:stage', async (c) => {
    const stage = c.req.param('stage');
    if (!isPromptStage(stage)) return c.json({ error: 'not_found' }, 404);
    const body = z.strictObject({ task: z.string().trim().min(20).max(20_000), note: z.string().max(500).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', issues: body.error.issues }, 400);
    const [max] = await queryRows<{ v: number }>(ctx.db, sql`select coalesce(max(version), 0)::int as v from prompt_version where stage = ${stage}`);
    const version = (max?.v ?? 0) + 1;
    await ctx.db.insert(schema.promptVersion).values({ stage, version, systemPrompt: body.data.task, userTemplate: '', active: false, note: body.data.note ?? null, createdBy: c.var.session!.user.id });
    const a = actor(c);
    await audit(a.id, a.ip, 'prompt.draft', 'prompt_version', `${stage}@${version}`, null, { note: body.data.note ?? null });
    return c.json({ stage, version }, 201);
  });

  /** Runs a draft (or any) version on sample input with the stage's model, without affecting real jobs. */
  r.post('/prompts/:stage/:version/test', async (c) => {
    const stage = c.req.param('stage');
    if (!isPromptStage(stage)) return c.json({ error: 'not_found' }, 404);
    const [v] = await ctx.db.select().from(schema.promptVersion).where(and(eq(schema.promptVersion.stage, stage), eq(schema.promptVersion.version, Number(c.req.param('version')))));
    if (!v) return c.json({ error: 'not_found' }, 404);
    const body = z.object({ input: z.unknown().optional() }).safeParse(await c.req.json().catch(() => ({})));
    const sample = body.success && body.data.input !== undefined ? body.data.input : { question: 'How can I become a better leader?' };
    try {
      const llm = await ctx.llm(stage === 'vision' ? 'vision' : (stage as ModelStage));
      const zschema = STAGE_SCHEMAS[stage];
      if (zschema) {
        const res = await completeJson(llm, [{ role: 'system', content: stageSystem(stage, v.systemPrompt) }, { role: 'user', content: input(sample) }], zschema, { retries: 0 }).catch((err: Error) => ({ error: err.message }));
        if ('error' in res) return c.json({ valid: false, output: null, issues: res.error });
        return c.json({ valid: true, output: JSON.stringify(res.data, null, 2) });
      }
      const res = await llm.chat([{ role: 'system', content: `STAGE: ${stage}\n${v.systemPrompt}` }, { role: 'user', content: typeof sample === 'string' ? sample : JSON.stringify(sample) }], { maxTokens: 600 });
      return c.json({ valid: res.content.trim().length > 0, output: textOf(res.content) });
    } catch (err) {
      return c.json({ valid: false, output: null, issues: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/prompts/:stage/:version/activate', async (c) => {
    const stage = c.req.param('stage');
    if (!isPromptStage(stage)) return c.json({ error: 'not_found' }, 404);
    const version = Number(c.req.param('version'));
    const done = await ctx.db.transaction(async (tx) => {
      const [v] = await tx.select().from(schema.promptVersion).where(and(eq(schema.promptVersion.stage, stage), eq(schema.promptVersion.version, version)));
      if (!v) return false;
      await tx.update(schema.promptVersion).set({ active: false }).where(eq(schema.promptVersion.stage, stage));
      await tx.update(schema.promptVersion).set({ active: true }).where(eq(schema.promptVersion.id, v.id));
      return true;
    });
    if (!done) return c.json({ error: 'not_found' }, 404);
    const a = actor(c);
    await audit(a.id, a.ip, 'prompt.activate', 'prompt_version', `${stage}@${version}`, null, { active: version });
    return c.json({ stage, active: version });
  });

  r.post('/prompts/:stage/reset', async (c) => {
    const stage = c.req.param('stage');
    if (!isPromptStage(stage)) return c.json({ error: 'not_found' }, 404);
    await ctx.db.update(schema.promptVersion).set({ active: false }).where(eq(schema.promptVersion.stage, stage));
    const a = actor(c);
    await audit(a.id, a.ip, 'prompt.reset', 'prompt_version', stage, null, { active: 'built-in' });
    return c.json({ stage, active: null });
  });

  // ---------- Quality review ----------
  r.get('/quality', async (c) => {
    const scope = c.req.query('scope');
    if (scope === 'recent') {
      const rows = await queryRows<{ id: string; title: string; series_title: string; created_at: string; scores: Record<string, number> | null; human_reviews: number }>(
        ctx.db,
        sql`select e.id, e.title, s.title as series_title, e.created_at,
              (select q.scores from episode_quality_check q where q.episode_id = e.id and q.checked_by = 'auto' order by q.revision desc limit 1) as scores,
              (select count(*)::int from episode_quality_check q where q.episode_id = e.id and q.checked_by = 'human') as human_reviews
            from episode e join podcast_series s on s.id = e.series_id
            where e.status = 'ready' order by e.created_at desc limit 30`,
      );
      return c.json({ recent: rows.map((r) => ({ id: r.id, title: r.title, seriesTitle: r.series_title, createdAt: r.created_at, scores: r.scores, humanReviews: r.human_reviews })) });
    }
    const held = await ctx.db.select().from(schema.episode).where(eq(schema.episode.status, 'needs_review')).orderBy(desc(schema.episode.updatedAt));
    const checks = held.length ? await ctx.db.select().from(schema.episodeQualityCheck).where(inArray(schema.episodeQualityCheck.episodeId, held.map((h) => h.id))) : [];
    return c.json({
      held: held.map((e) => {
        const latest = checks.filter((q) => q.episodeId === e.id).sort((a, b) => b.revision - a.revision)[0];
        return {
          id: e.id,
          title: e.title,
          scores: latest?.scores ?? null,
          notes: latest?.notes ?? [],
          reviews: checks.filter((q) => q.episodeId === e.id).length,
          script: (e.script ?? []).map((s) => `${s.speaker}: ${s.text}`).join('\n\n').slice(0, 20_000),
        };
      }),
    });
  });

  /**
   * After a rejection: when every episode left is ready, the series and its job are complete (no "some
   * episodes could not be finished"). When none is left, the series is failed and hidden from the listener.
   */
  async function settleAfterRejection(seriesId: string) {
    const eps = await ctx.db.select({ status: schema.episode.status }).from(schema.episode).where(eq(schema.episode.seriesId, seriesId));
    const left = eps.filter((x) => x.status !== 'rejected');
    if (left.length === 0) {
      await ctx.db.update(schema.podcastSeries).set({ status: 'failed' }).where(eq(schema.podcastSeries.id, seriesId));
      return;
    }
    if (!left.every((x) => x.status === 'ready')) return;
    await ctx.db.update(schema.podcastSeries).set({ status: 'ready' }).where(eq(schema.podcastSeries.id, seriesId));
    await ctx.db
      .update(schema.generationJob)
      .set({ status: 'succeeded', error: null })
      .where(and(eq(schema.generationJob.seriesId, seriesId), inArray(schema.generationJob.status, ['partial', 'failed'])));
  }

  r.post('/quality/:episodeId', async (c) => {
    const body = z.strictObject({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(3).max(2000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', message: 'Choose approve or reject and add a short note.' }, 400);
    const [e] = await ctx.db.select().from(schema.episode).where(and(eq(schema.episode.id, c.req.param('episodeId')), eq(schema.episode.status, 'needs_review')));
    if (!e) return c.json({ error: 'not_found' }, 404);
    const [max] = await queryRows<{ v: number }>(ctx.db, sql`select coalesce(max(revision), 0)::int as v from episode_quality_check where episode_id = ${e.id}`);
    const [latest] = await ctx.db.select().from(schema.episodeQualityCheck).where(eq(schema.episodeQualityCheck.episodeId, e.id)).orderBy(desc(schema.episodeQualityCheck.revision)).limit(1);
    const approve = body.data.decision === 'approve';
    await ctx.db.insert(schema.episodeQualityCheck).values({ episodeId: e.id, revision: (max?.v ?? 0) + 1, passed: approve ? 1 : 0, scores: latest?.scores ?? {}, notes: [body.data.note], checkedBy: 'human' });
    if (approve) {
      // Resume the original job: the saved script is voiced without another automatic review.
      await ctx.db.update(schema.episode).set({ status: 'pending' }).where(eq(schema.episode.id, e.id));
      await ctx.db.update(schema.podcastSeries).set({ status: 'generating' }).where(eq(schema.podcastSeries.id, e.seriesId));
      const [job] = await ctx.db.select().from(schema.generationJob).where(eq(schema.generationJob.seriesId, e.seriesId)).orderBy(desc(schema.generationJob.createdAt)).limit(1);
      if (job) {
        await ctx.db
          .update(schema.generationJob)
          .set({ status: 'queued', runAfter: new Date(), attempts: 0, error: null, finishedAt: null, lockedBy: null, lockedUntil: null, cancelRequested: 0 })
          .where(eq(schema.generationJob.id, job.id));
        ctx.pokeWorker();
      }
    } else {
      // A rejected episode is taken off the listener's series; the rest of the series stands on its own.
      await ctx.db.update(schema.episode).set({ status: 'rejected' }).where(eq(schema.episode.id, e.id));
      await settleAfterRejection(e.seriesId);
    }
    const a = actor(c);
    await audit(a.id, a.ip, approve ? 'quality.approve' : 'quality.reject', 'episode', e.id, { status: 'needs_review' }, { status: approve ? 'pending' : 'rejected', note: body.data.note });
    return c.json({ id: e.id, decision: body.data.decision });
  });

  r.post('/quality/:episodeId/review', async (c) => {
    const body = z.strictObject({ score: z.number().int().min(1).max(5), note: z.string().trim().max(2000).default('') }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    const [e] = await ctx.db.select({ id: schema.episode.id }).from(schema.episode).where(eq(schema.episode.id, c.req.param('episodeId')));
    if (!e) return c.json({ error: 'not_found' }, 404);
    const { settings } = await ctx.settings.getActive();
    const [max] = await queryRows<{ v: number }>(ctx.db, sql`select coalesce(max(revision), 0)::int as v from episode_quality_check where episode_id = ${e.id}`);
    await ctx.db.insert(schema.episodeQualityCheck).values({ episodeId: e.id, revision: (max?.v ?? 0) + 1, passed: body.data.score >= settings.quality.minScore ? 1 : 0, scores: { overall: body.data.score }, notes: body.data.note ? [body.data.note] : [], checkedBy: 'human' });
    return c.json({ id: e.id, score: body.data.score });
  });

  // ---------- Usage ----------
  r.get('/usage', async (c) => {
    const { settings } = await ctx.settings.getActive();
    const day = new Date(Date.now() - 86400_000);
    const month = new Date(Date.now() - 30 * 86400_000);
    const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await queryRows<T>(ctx.db, q))[0]!;
    const users = await one<{ total: number; active7: number; new30: number }>(sql`select (select count(*)::int from "user") as total,
        (select count(distinct user_id)::int from session where updated_at > now() - interval '7 days') as active7,
        (select count(*)::int from "user" where created_at > now() - interval '30 days') as new30`);
    const gens = await queryRows<{ status: string; n: number }>(ctx.db, sql`select status, count(*)::int as n from generation_job where created_at > ${month.toISOString()}::timestamptz group by status`);
    const timing = await one<{ avg_seconds: number | null }>(sql`select avg(extract(epoch from (finished_at - started_at)))::float as avg_seconds from generation_job where status = 'succeeded' and finished_at is not null and created_at > ${month.toISOString()}::timestamptz`);
    const episodes = await one<{ ready: number; minutes: number; held: number }>(sql`select count(*) filter (where status = 'ready')::int as ready, coalesce(sum(duration_seconds) filter (where status = 'ready'), 0)::float / 60 as minutes, count(*) filter (where status = 'needs_review')::int as held from episode`);
    const storage = await one<{ audio: number; uploads: number }>(sql`select coalesce((select sum(audio_bytes) from episode where audio_key is not null), 0)::float as audio, coalesce((select sum(bytes) from media_upload where status <> 'deleted'), 0)::float as uploads`);
    let dbBytes: number | null = null;
    try {
      dbBytes = Number((await one<{ b: number }>(sql`select pg_database_size(current_database())::float as b`)).b);
    } catch {
      dbBytes = null;
    }
    const tokens = await one<{ day: number; month: number }>(sql`select coalesce(sum(value) filter (where created_at > ${day.toISOString()}::timestamptz), 0)::float as day, coalesce(sum(value), 0)::float as month from usage_metric where metric = 'llm_tokens' and created_at > ${month.toISOString()}::timestamptz`);
    const tts = await one<{ seconds: number }>(sql`select coalesce(sum(value), 0)::float as seconds from usage_metric where metric = 'tts_seconds' and created_at > ${month.toISOString()}::timestamptz`);
    const emails = await one<{ sent: number; failed: number }>(sql`select count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed from email_delivery where created_at > ${month.toISOString()}::timestamptz`);
    const quality = await one<{ first_pass: number | null; avg_revisions: number | null }>(sql`
        select avg(case when q1.passed = 1 then 1 else 0 end)::float as first_pass,
               avg(revs)::float as avg_revisions
        from (select episode_id, max(revision) as revs from episode_quality_check where checked_by = 'auto' group by episode_id) r
        join episode_quality_check q1 on q1.episode_id = r.episode_id and q1.revision = 1`);
    const models = await ctx.db.select({ stage: schema.aiModelConfig.stage, provider: schema.aiModelConfig.provider, model: schema.aiModelConfig.model }).from(schema.aiModelConfig);
    const failedJobs = gens.find((g) => g.status === 'failed')?.n ?? 0;
    const storageGb = (storage.audio + storage.uploads) / 1024 ** 3;
    const est =
      (tokens.month / 1e6) * settings.costs.llmPerMillionTokensUsd + (tts.seconds / 3600) * settings.costs.ttsPerHourUsd + storageGb * settings.costs.storagePerGbMonthUsd;
    const alert = (key: string, label: string, used: number, limit: number) => {
      const pct = limit > 0 ? used / limit : 0;
      return { key, label, used, limit, percent: Math.round(pct * 100), level: pct >= 1 ? 'over' : pct >= 0.8 ? 'warning' : 'ok' };
    };
    return c.json({
      users: { total: users.total, activeLast7Days: users.active7, newLast30Days: users.new30 },
      generations: { last30Days: Object.fromEntries(gens.map((g) => [g.status, g.n])), failedLast30Days: failedJobs, averageProcessingSeconds: timing.avg_seconds },
      episodes: { ready: episodes.ready, minutesOfAudio: Math.round(episodes.minutes), heldForReview: episodes.held },
      storage: { audioBytes: storage.audio, uploadBytes: storage.uploads, databaseBytes: dbBytes },
      tokens: { last24Hours: tokens.day, last30Days: tokens.month },
      speech: { secondsLast30Days: tts.seconds },
      emails: { sentLast30Days: emails.sent, failedLast30Days: emails.failed },
      quality: { firstPassRate: quality.first_pass ?? 0, averageReviews: quality.avg_revisions ?? 0 },
      models,
      bandwidth: { measured: false, note: 'Bandwidth is measured by the hosts. See the Vercel and Cloudflare dashboards.' },
      costs: { estimatedMonthlyUsd: Number(est.toFixed(2)), basis: settings.costs },
      alerts: [
        alert('storageGb', 'Object storage (GB)', Number(storageGb.toFixed(3)), settings.alerts.storageGb),
        alert('databaseMb', 'Database size (MB)', dbBytes ? Math.round(dbBytes / 1048576) : 0, settings.alerts.databaseMb),
        alert('dailyLlmTokens', 'Language-model tokens in the last 24 hours', tokens.day, settings.alerts.dailyLlmTokens),
        alert('monthlyEmails', 'Emails in the last 30 days', emails.sent + emails.failed, settings.alerts.monthlyEmails),
      ],
    });
  });

  // ---------- Activity report: what each person generated, what went wrong, what they rated ----------
  r.get('/report', async (c) => {
    const days = Number(c.req.query('days') ?? 30);
    if (![7, 30, 90, 365].includes(days)) return c.json({ error: 'invalid_request', message: 'days must be 7, 30, 90 or 365' }, 400);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const people = await queryRows<{
      id: string; name: string; email: string; created_at: string; requests: number; series: number; episodes: number; minutes: number;
      failed: number; partial: number; cancelled: number; ratings: number; avg_stars: number | null; last_request: string | null;
    }>(
      ctx.db,
      sql`select u.id, u.name, u.email, u.created_at,
            (select count(*)::int from generation_job j where j.user_id = u.id and j.created_at > ${since}::timestamptz) as requests,
            (select count(distinct j.series_id)::int from generation_job j where j.user_id = u.id and j.series_id is not null and j.created_at > ${since}::timestamptz) as series,
            (select count(*)::int from episode e join podcast_series s on s.id = e.series_id where s.user_id = u.id and e.status = 'ready' and e.created_at > ${since}::timestamptz) as episodes,
            (select coalesce(sum(e.duration_seconds), 0)::float / 60 from episode e join podcast_series s on s.id = e.series_id where s.user_id = u.id and e.status = 'ready' and e.created_at > ${since}::timestamptz) as minutes,
            (select count(*)::int from generation_job j where j.user_id = u.id and j.status = 'failed' and j.created_at > ${since}::timestamptz) as failed,
            (select count(*)::int from generation_job j where j.user_id = u.id and j.status = 'partial' and j.created_at > ${since}::timestamptz) as partial,
            (select count(*)::int from generation_job j where j.user_id = u.id and j.status = 'cancelled' and j.created_at > ${since}::timestamptz) as cancelled,
            (select count(*)::int from rating r where r.user_id = u.id and r.updated_at > ${since}::timestamptz) as ratings,
            (select avg(r.stars)::float from rating r where r.user_id = u.id and r.updated_at > ${since}::timestamptz) as avg_stars,
            (select max(j.created_at) from generation_job j where j.user_id = u.id) as last_request
          from "user" u
          order by last_request desc nulls last, u.created_at desc`,
    );
    const jobs = await queryRows<{
      id: string; user_id: string; email: string; topic: string | null; series_id: string | null; series_title: string | null; status: string;
      current_stage: string | null; error: string | null; episodes: number | null; ready: number; rejected: number; tokens: number; created_at: string; finished_at: string | null;
    }>(
      ctx.db,
      sql`select j.id, j.user_id, u.email, coalesce(lr.input_text, lr.input_transcript) as topic, j.series_id, s.title as series_title, j.status,
            j.current_stage, j.error, (j.options->>'episodes')::int as episodes,
            (select count(*)::int from episode e where e.series_id = j.series_id and e.status = 'ready') as ready,
            (select count(*)::int from episode e where e.series_id = j.series_id and e.status = 'rejected') as rejected,
            j.tokens_used as tokens, j.created_at, j.finished_at
          from generation_job j
          join "user" u on u.id = j.user_id
          left join learning_request lr on lr.id = j.learning_request_id
          left join podcast_series s on s.id = j.series_id
          where j.created_at > ${since}::timestamptz
          order by j.created_at desc limit 500`,
    );
    const ratings = await queryRows<{ user_id: string; email: string; episode_id: string; episode_title: string; series_title: string; stars: number; rated_at: string }>(
      ctx.db,
      sql`select r.user_id, u.email, e.id as episode_id, e.title as episode_title, s.title as series_title, r.stars, r.updated_at as rated_at
          from rating r join "user" u on u.id = r.user_id join episode e on e.id = r.episode_id join podcast_series s on s.id = e.series_id
          where r.updated_at > ${since}::timestamptz
          order by r.updated_at desc limit 500`,
    );
    const generation = jobs.map((j) => ({
      id: j.id, userId: j.user_id, email: j.email, topic: (j.topic ?? '').slice(0, 300), seriesId: j.series_id, seriesTitle: j.series_title, status: j.status,
      stage: j.current_stage, episodesRequested: j.episodes, episodesReady: j.ready, episodesRejected: j.rejected, tokens: j.tokens, createdAt: j.created_at, finishedAt: j.finished_at,
    }));
    // Errors: jobs that failed, finished only partly, or are waiting after a problem (rate limits, retries).
    const errors = jobs
      .filter((j) => j.status === 'failed' || j.status === 'partial' || (j.error && (j.status === 'queued' || j.status === 'running')))
      .map((j) => ({ jobId: j.id, userId: j.user_id, email: j.email, seriesTitle: j.series_title, topic: (j.topic ?? '').slice(0, 300), status: j.status, stage: j.current_stage, error: j.error ?? 'No message was recorded.', createdAt: j.created_at }));
    return c.json({
      days,
      totals: {
        people: people.filter((p) => p.requests > 0).length,
        requests: jobs.length,
        episodes: people.reduce((n, p) => n + p.episodes, 0),
        errors: errors.length,
        ratings: ratings.length,
        averageStars: ratings.length ? Number((ratings.reduce((n, r) => n + r.stars, 0) / ratings.length).toFixed(2)) : null,
      },
      people: people.map((p) => ({
        id: p.id, name: p.name, email: p.email, joinedAt: p.created_at, requests: p.requests, series: p.series, episodes: p.episodes, minutes: Math.round(p.minutes),
        failed: p.failed, partial: p.partial, cancelled: p.cancelled, ratings: p.ratings, averageStars: p.avg_stars === null ? null : Number(Number(p.avg_stars).toFixed(2)), lastRequestAt: p.last_request,
      })),
      generation,
      errors,
      ratings: ratings.map((r) => ({ userId: r.user_id, email: r.email, episodeId: r.episode_id, episodeTitle: r.episode_title, seriesTitle: r.series_title, stars: r.stars, ratedAt: r.rated_at })),
    });
  });

  // A podcast that errored out (failed or only partly finished) is put back in the queue for its owner. The
  // worker resumes from the saved progress; finished episodes are kept.
  r.post('/generations/:id/restart', async (c) => {
    const [job] = await ctx.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, c.req.param('id')));
    if (!job) return c.json({ error: 'not_found' }, 404);
    const result = await restartJob(ctx, job, ['failed', 'partial']);
    if (!result.ok) return c.json({ error: 'not_restartable', message: job.status === 'queued' || job.status === 'running' ? 'This podcast is already in the queue.' : job.status === 'succeeded' ? 'This podcast finished; there is nothing to restart.' : result.message }, result.status);
    const a = actor(c);
    await audit(a.id, a.ip, 'generation.restart', 'generation_job', job.id, { status: job.status, error: job.error }, { status: 'queued' });
    return c.json({ id: job.id, status: 'queued' }, 202);
  });

  // ---------- Everyone's podcasts ----------
  // Every listener's podcasts, newest first, with their owner and progress. Admins can open and play any of
  // them (the series and audio routes let administrators read every series), regenerate or delete them.
  r.get('/podcasts', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    const status = c.req.query('status');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = await queryRows<{
      id: string; title: string; status: string; visibility: string; language: string; created_at: string; owner_id: string; owner: string;
      episode_count: number; ready_count: number; job_id: string | null; job_status: string | null; job_error: string | null;
    }>(
      ctx.db,
      sql`select s.id, s.title, s.status, s.visibility, s.language, s.created_at, u.id as owner_id, u.email as owner,
            (select count(*)::int from episode e where e.series_id = s.id and e.status <> 'rejected') as episode_count,
            (select count(*)::int from episode e where e.series_id = s.id and e.status = 'ready') as ready_count,
            j.id as job_id, j.status as job_status, j.error as job_error
          from podcast_series s
          join "user" u on u.id = s.user_id
          left join lateral (select id, status, error from generation_job g where g.series_id = s.id and not (g.options ? 'translate') order by g.created_at desc limit 1) j on true
          where (${q} = '' or s.title ilike ${like} or u.email ilike ${like})
            and (${status ?? ''} = '' or s.status = ${status ?? ''})
          order by s.created_at desc
          limit ${limit + 1} offset ${offset}`,
    );
    return c.json({
      podcasts: rows.slice(0, limit).map((r) => ({
        id: r.id, title: r.title, status: r.status, visibility: r.visibility, language: r.language, createdAt: r.created_at,
        owner: { id: r.owner_id, email: r.owner }, episodeCount: r.episode_count, readyCount: r.ready_count,
        job: r.job_id ? { id: r.job_id, status: r.job_status, error: r.job_error } : null,
      })),
      more: rows.length > limit,
    });
  });

  // Writes and records a podcast's episodes again (all of them, or the ones named) from its saved plan.
  r.post('/podcasts/:id/regenerate', async (c) => {
    const body = z.strictObject({ episodeIds: z.array(z.string().min(1)).max(50).optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    try {
      const jobId = await regenerateSeries(ctx, c.req.param('id'), body.data.episodeIds);
      const a = actor(c);
      await audit(a.id, a.ip, 'series.regenerate', 'podcast_series', c.req.param('id'), null, { jobId, episodeIds: body.data.episodeIds ?? 'all' });
      return c.json({ jobId, status: 'queued' }, 202);
    } catch (err) {
      if (err instanceof RegenerateError) return c.json({ error: err.code, message: err.message }, err.status);
      throw err;
    }
  });

  // Deletes a podcast for good: its episodes, audio and everything listeners saved about it.
  r.delete('/podcasts/:id', async (c) => {
    const body = z.strictObject({ reason: z.string().trim().min(3).max(500) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', message: 'Give a short reason.' }, 400);
    const [s] = await ctx.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, c.req.param('id')));
    if (!s) return c.json({ error: 'not_found' }, 404);
    const [owner] = await ctx.db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, s.userId));
    // A podcast still being made is stopped first, so the worker writes nothing more for it.
    await ctx.db
      .update(schema.generationJob)
      .set({ status: 'cancelled', cancelRequested: 1, lockedBy: null, lockedUntil: null, finishedAt: new Date() })
      .where(and(eq(schema.generationJob.seriesId, s.id), inArray(schema.generationJob.status, ['queued', 'running'])));
    const eps = await ctx.db.select({ id: schema.episode.id, key: schema.episode.audioKey }).from(schema.episode).where(eq(schema.episode.seriesId, s.id));
    const translated = eps.length
      ? await ctx.db.select({ key: schema.episodeTranslation.audioKey }).from(schema.episodeTranslation).where(inArray(schema.episodeTranslation.episodeId, eps.map((e) => e.id)))
      : [];
    for (const k of [...eps.map((e) => e.key), ...translated.map((t) => t.key)]) if (k) await ctx.storage.delete(k).catch(() => {});
    await ctx.db.delete(schema.podcastSeries).where(eq(schema.podcastSeries.id, s.id));
    const a = actor(c);
    await audit(a.id, a.ip, 'series.delete', 'podcast_series', s.id, { title: s.title, owner: owner?.email ?? null, episodes: eps.length }, { reason: body.data.reason });
    return c.json({ deleted: true });
  });

  // ---------- Public content moderation ----------
  r.get('/public', async (c) => {
    const rows = await ctx.db
      .select({ id: schema.podcastSeries.id, title: schema.podcastSeries.title, publicSlug: schema.podcastSeries.publicSlug, createdAt: schema.podcastSeries.createdAt, owner: schema.user.email })
      .from(schema.podcastSeries)
      .innerJoin(schema.user, eq(schema.user.id, schema.podcastSeries.userId))
      .where(eq(schema.podcastSeries.visibility, 'public'))
      .orderBy(desc(schema.podcastSeries.createdAt));
    return c.json({ series: rows });
  });

  r.post('/public/:id/unpublish', async (c) => {
    const body = z.strictObject({ reason: z.string().trim().min(3).max(500) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', message: 'Give a short reason.' }, 400);
    const [s] = await ctx.db.select().from(schema.podcastSeries).where(and(eq(schema.podcastSeries.id, c.req.param('id')), eq(schema.podcastSeries.visibility, 'public')));
    if (!s) return c.json({ error: 'not_found' }, 404);
    await ctx.db.update(schema.podcastSeries).set({ visibility: 'private' }).where(eq(schema.podcastSeries.id, s.id));
    const a = actor(c);
    await audit(a.id, a.ip, 'series.unpublish', 'podcast_series', s.id, { visibility: 'public' }, { visibility: 'private', reason: body.data.reason });
    return c.json({ id: s.id, visibility: 'private' });
  });

  // ---------- Audit log ----------
  r.get('/audit', async (c) => {
    const action = c.req.query('action');
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 100)));
    const since = c.req.query('since');
    if (since && Number.isNaN(Date.parse(since))) return c.json({ error: 'invalid_request', message: 'since must be a date' }, 400);
    const rows = await ctx.db
      .select({ id: schema.auditLog.id, action: schema.auditLog.action, targetType: schema.auditLog.targetType, targetId: schema.auditLog.targetId, before: schema.auditLog.before, after: schema.auditLog.after, ip: schema.auditLog.ip, createdAt: schema.auditLog.createdAt, actor: schema.user.email })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
      .where(and(action ? eq(schema.auditLog.action, action) : undefined, since ? gte(schema.auditLog.createdAt, new Date(since)) : undefined))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(limit);
    return c.json({ entries: rows });
  });

  return r;
}
