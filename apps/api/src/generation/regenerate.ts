import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { restartJob } from './restart';

export class RegenerateError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Makes a podcast's episodes again (an administrator's "regenerate"): each chosen episode is written afresh
 * from the series' saved plan (same topic, mental model, hosts and voices), reviewed and recorded again. With
 * no episodes named, every episode is. A series that never got as far as a plan is started over instead.
 * The new audio replaces the old when it is ready. Returns the job that does it.
 */
export async function regenerateSeries(ctx: AppContext, seriesId: string, episodeIds?: string[]): Promise<string> {
  const [series] = await ctx.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, seriesId));
  if (!series) throw new RegenerateError(404, 'not_found', 'This podcast was not found.');
  const busy = await ctx.db
    .select({ id: schema.generationJob.id })
    .from(schema.generationJob)
    .where(and(eq(schema.generationJob.seriesId, seriesId), inArray(schema.generationJob.status, ['queued', 'running'])));
  if (busy.length) throw new RegenerateError(409, 'busy', 'This podcast is already being worked on. Try again when it has finished.');

  // The latest job that made or added to the series (not one voicing a translation) holds its plan.
  const jobs = (await ctx.db.select().from(schema.generationJob).where(eq(schema.generationJob.seriesId, seriesId)).orderBy(desc(schema.generationJob.createdAt))).filter(
    (j) => !(j.options as { translate?: unknown }).translate,
  );
  const base = jobs[0];
  if (!base) throw new RegenerateError(409, 'no_job', 'This podcast has no generation to start again from.');
  const baseState = (base.state ?? {}) as Record<string, unknown> & { plan?: { episodes: Array<{ number: number }> }; scripts?: Record<string, unknown> };
  if (!baseState.plan) {
    // Never planned (it failed early): run it again from the start.
    const r = await restartJob(ctx, base, ['failed', 'partial', 'cancelled', 'succeeded']);
    if (!r.ok) throw new RegenerateError(409, 'busy', r.message);
    return base.id;
  }

  const all = await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId)).orderBy(asc(schema.episode.number));
  const targets = all.filter((e) => e.status !== 'rejected' && (!episodeIds?.length || episodeIds.includes(e.id)));
  if (!targets.length) throw new RegenerateError(404, 'not_found', 'There is no episode to regenerate.');
  const ids = targets.map((e) => e.id);

  // Fresh scripts: drop the saved drafts, reviews (including any person's approval of the old script) and
  // translations of the old episodes.
  const { tokens: _t, rateLimitRetries: _r, rateLimitedSince: _s, autoRestarts: _a, planDraft: _p, replan: _rp, extendTo: _e, ...state } = baseState;
  const scripts = { ...(baseState.scripts ?? {}) };
  for (const e of targets) delete scripts[String(e.number)];
  state.scripts = scripts;
  await ctx.db.delete(schema.episodeQualityCheck).where(inArray(schema.episodeQualityCheck.episodeId, ids));
  await ctx.db.delete(schema.episodeTranslation).where(inArray(schema.episodeTranslation.episodeId, ids));
  await ctx.db.update(schema.episode).set({ status: 'pending' }).where(inArray(schema.episode.id, ids));

  const [job] = await ctx.db
    .insert(schema.generationJob)
    .values({ userId: series.userId, learningRequestId: base.learningRequestId, seriesId, options: base.options, state: state as Record<string, unknown> })
    .returning({ id: schema.generationJob.id });
  await ctx.db.update(schema.podcastSeries).set({ status: 'generating', updatedAt: sql`now()` }).where(eq(schema.podcastSeries.id, seriesId));
  ctx.pokeWorker();
  return job!.id;
}
