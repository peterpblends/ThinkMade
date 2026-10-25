import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@thinkmade/db';
import { createGenerationSchema, labelForStage, READY_LABEL, STAGE_LABELS } from '@thinkmade/shared';
import type { AppContext } from '../create-context';
import { LimitError, resolveOptions } from '../generation/options';
import { requireVerified, type AppVariables } from '../middleware/session';

type StepState = 'pending' | 'active' | 'done' | 'failed';

/** Builds the four user-facing steps from the real stage records. */
export function steps(status: string, current: string | null, doneStages: Set<string>): Array<{ label: string; state: StepState }> {
  // A step is done once a later one has begun: some stages (photo analysis) only run when needed.
  const reached = STAGE_LABELS.reduce((max, s, i) => ((s.stages as readonly string[]).some((x) => doneStages.has(x) || x === current) ? i : max), -1);
  return STAGE_LABELS.map((s, i) => {
    const all = i < reached || (s.stages as readonly string[]).every((x) => doneStages.has(x));
    const active = (s.stages as readonly string[]).includes(current ?? '');
    let state: StepState = 'pending';
    if (status === 'succeeded' || all) state = 'done';
    else if (active && status === 'running') state = 'active';
    else if (active && (status === 'failed' || status === 'partial')) state = 'failed';
    return { label: s.label, state };
  });
}

export function generationRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.post('/generations', requireVerified(), async (c) => {
    const user = c.var.session!.user;
    const parsed = createGenerationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const { settings } = await ctx.settings.getActive();

    // Failed or cancelled attempts don't use up the daily allowance, and administrators have none.
    const since = new Date(ctx.now().getTime() - 24 * 3600 * 1000);
    const isAdmin = (user.role ?? '').split(',').map((r: string) => r.trim()).includes('admin');
    const [recent] = isAdmin
      ? [{ n: 0 }]
      : await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.generationJob)
          .where(and(eq(schema.generationJob.userId, user.id), gte(schema.generationJob.createdAt, since), notInArray(schema.generationJob.status, ['failed', 'cancelled'])));
    if ((recent?.n ?? 0) >= settings.limits.perUserDailyJobs) {
      return c.json({ error: 'daily_limit', message: `You can create ${settings.limits.perUserDailyJobs} series a day. Please try again tomorrow.` }, 429);
    }

    let options;
    try {
      options = resolveOptions(settings, parsed.data);
    } catch (err) {
      if (err instanceof LimitError) return c.json({ error: 'exceeds_limits', message: err.message }, 400);
      throw err;
    }

    // Only the owner's own uploads may be attached.
    const uploads = parsed.data.mediaUploadIds;
    if (uploads.length) {
      const owned = await ctx.db
        .select({ id: schema.mediaUpload.id, kind: schema.mediaUpload.kind })
        .from(schema.mediaUpload)
        .where(and(eq(schema.mediaUpload.userId, user.id), inArray(schema.mediaUpload.id, uploads), inArray(schema.mediaUpload.status, ['uploaded', 'validated'])));
      if (owned.length !== new Set(uploads).size) return c.json({ error: 'invalid_media' }, 400);
      if (owned.filter((o) => o.kind === 'image').length > settings.media.maxImages) {
        return c.json({ error: 'too_many_images', message: `You can add up to ${settings.media.maxImages} photos.` }, 400);
      }
      if (owned.filter((o) => o.kind === 'video').length > 2) return c.json({ error: 'too_many_videos', message: 'You can add up to 2 videos.' }, 400);
    }

    if (parsed.data.coachingSessionId) {
      const [cs] = await ctx.db
        .select({ id: schema.coachingSession.id })
        .from(schema.coachingSession)
        .where(and(eq(schema.coachingSession.id, parsed.data.coachingSessionId), eq(schema.coachingSession.userId, user.id)));
      if (!cs) return c.json({ error: 'invalid_coaching_session' }, 400);
    }

    if (parsed.data.parentSeriesId) {
      const { readableSeries } = await import('./series');
      const ps = await readableSeries(ctx.db, parsed.data.parentSeriesId, user.id);
      if (!ps) return c.json({ error: 'invalid_parent_series' }, 400);
    }

    const [req] = await ctx.db
      .insert(schema.learningRequest)
      .values({
        userId: user.id,
        inputText: parsed.data.topic || null,
        mediaUploadIds: uploads,
        learningMode: options.learningMode,
        customization: parsed.data.customization ?? {},
        parentRequestId: null,
        coachingSessionId: parsed.data.coachingSessionId ?? null,
        parentSeriesId: parsed.data.parentSeriesId ?? null,
        updateMode: Boolean(parsed.data.update && parsed.data.parentSeriesId),
      })
      .returning({ id: schema.learningRequest.id });
    const [job] = await ctx.db
      .insert(schema.generationJob)
      .values({ userId: user.id, learningRequestId: req!.id, options: options as unknown as Record<string, unknown> })
      .returning({ id: schema.generationJob.id });
    ctx.pokeWorker();
    return c.json({ id: job!.id, status: 'queued' }, 202);
  });

  r.get('/generations', requireVerified(), async (c) => {
    const rows = await ctx.db
      .select({ id: schema.generationJob.id, status: schema.generationJob.status, currentStage: schema.generationJob.currentStage, seriesId: schema.generationJob.seriesId, createdAt: schema.generationJob.createdAt, topic: schema.learningRequest.inputText })
      .from(schema.generationJob)
      .innerJoin(schema.learningRequest, eq(schema.learningRequest.id, schema.generationJob.learningRequestId))
      .where(eq(schema.generationJob.userId, c.var.session!.user.id))
      .orderBy(desc(schema.generationJob.createdAt))
      .limit(20);
    return c.json({
      generations: rows.map((g) => ({ ...g, label: g.status === 'succeeded' ? READY_LABEL : labelForStage(g.currentStage) })),
    });
  });

  r.get('/generations/:id', requireVerified(), async (c) => {
    const [job] = await ctx.db
      .select()
      .from(schema.generationJob)
      .where(and(eq(schema.generationJob.id, c.req.param('id')), eq(schema.generationJob.userId, c.var.session!.user.id)));
    if (!job) return c.json({ error: 'not_found' }, 404);
    const stageRows = await ctx.db.select().from(schema.generationStage).where(eq(schema.generationStage.jobId, job.id));
    const doneStages = new Set(stageRows.filter((s) => s.status === 'done').map((s) => s.stage));
    // A stage with per-episode rows is only done when no row for it is still open.
    for (const s of stageRows) if (s.status !== 'done') doneStages.delete(s.stage);
    const episodes = job.seriesId
      ? await ctx.db
          .select({ id: schema.episode.id, number: schema.episode.number, title: schema.episode.title, status: schema.episode.status })
          .from(schema.episode)
          .where(eq(schema.episode.seriesId, job.seriesId))
          .orderBy(schema.episode.number)
      : [];
    return c.json({
      id: job.id,
      status: job.status,
      label: job.status === 'succeeded' ? READY_LABEL : labelForStage(job.currentStage),
      steps: steps(job.status, job.currentStage, doneStages),
      error: ['failed', 'partial', 'cancelled'].includes(job.status) ? job.error : null,
      retrying: job.status === 'queued' && job.attempts > 0,
      seriesId: job.seriesId,
      episodes,
    });
  });

  r.post('/generations/:id/cancel', requireVerified(), async (c) => {
    const updated = await ctx.db
      .update(schema.generationJob)
      .set({ cancelRequested: 1 })
      .where(and(eq(schema.generationJob.id, c.req.param('id')), eq(schema.generationJob.userId, c.var.session!.user.id), inArray(schema.generationJob.status, ['queued', 'running'])))
      .returning({ id: schema.generationJob.id });
    if (!updated.length) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}
