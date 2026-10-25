import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';

export type FollowUp = { kind: 'extend'; count: number } | { kind: 'replace'; episodeId: string };

export class FollowUpError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Starts a job that continues an existing series: more episodes after the last one, or a replacement for an
 * episode a reviewer rejected. It carries over the series' saved understanding, models, books, hosts and plan,
 * so the new episodes fit in and sound the same.
 */
export async function startFollowUp(ctx: AppContext, seriesId: string, userId: string, req: FollowUp): Promise<string> {
  const [series] = await ctx.db.select().from(schema.podcastSeries).where(and(eq(schema.podcastSeries.id, seriesId), eq(schema.podcastSeries.userId, userId)));
  if (!series) throw new FollowUpError(404, 'not_found', 'This series was not found.');
  const busy = await ctx.db
    .select({ id: schema.generationJob.id })
    .from(schema.generationJob)
    .where(and(eq(schema.generationJob.seriesId, seriesId), inArray(schema.generationJob.status, ['queued', 'running'])));
  if (busy.length) throw new FollowUpError(409, 'busy', 'This series is still being worked on. Please wait until it is finished.');
  const [base] = await ctx.db.select().from(schema.generationJob).where(eq(schema.generationJob.seriesId, seriesId)).orderBy(desc(schema.generationJob.createdAt)).limit(1);
  const baseState = (base?.state ?? {}) as Record<string, unknown> & { plan?: { episodes: unknown[] }; adjusted?: Record<string, unknown>; hosts?: unknown[] };
  if (!base || !baseState.plan) throw new FollowUpError(409, 'not_ready', 'This series has to finish before it can be added to.');
  const episodes = await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));

  const { tokens: _t, rateLimitRetries: _r, planDraft: _p, ...state } = baseState;
  // Series made before hosts were saved keep the hosts their episodes already have.
  if (!state.hosts) {
    const hosts = [...episodes].sort((a, b) => (b.hosts?.length ?? 0) - (a.hosts?.length ?? 0))[0]?.hosts;
    if (hosts?.length) state.hosts = hosts;
  }
  let options = base.options as Record<string, unknown>;

  if (req.kind === 'extend') {
    const { settings } = await ctx.settings.getActive();
    // Removed episodes keep their place (they can be replaced), so they count.
    const shown = episodes.length;
    const max = settings.podcast.maxEpisodesPerSeries;
    if (shown + req.count > max) {
      throw new FollowUpError(400, 'exceeds_limits', shown >= max ? `This series already has the most episodes a series can have (${max}).` : `You can add up to ${max - shown} more episode${max - shown === 1 ? '' : 's'} to this series.`);
    }
    const extendTo = baseState.plan.episodes.length + req.count;
    state.extendTo = extendTo;
    // The new total replaces any count taken from the listener's original words.
    state.adjusted = { ...(baseState.adjusted ?? {}), episodes: extendTo };
    options = { ...options, episodes: extendTo };
  } else {
    const ep = episodes.find((e) => e.id === req.episodeId);
    if (!ep) throw new FollowUpError(404, 'not_found', 'This episode was not found.');
    if (ep.status !== 'rejected') throw new FollowUpError(409, 'not_rejected', 'Only an episode that was removed after review can be replaced.');
    state.replan = [ep.number];
    await ctx.db.update(schema.episode).set({ status: 'pending' }).where(eq(schema.episode.id, ep.id));
  }

  const [job] = await ctx.db
    .insert(schema.generationJob)
    .values({ userId, learningRequestId: base.learningRequestId, seriesId, options, state })
    .returning({ id: schema.generationJob.id });
  await ctx.db.update(schema.podcastSeries).set({ status: 'generating' }).where(eq(schema.podcastSeries.id, seriesId));
  ctx.pokeWorker();
  return job!.id;
}
