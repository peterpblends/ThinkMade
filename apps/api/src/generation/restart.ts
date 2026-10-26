import { and, eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';

type Job = typeof schema.generationJob.$inferSelect;

export type RestartResult = { ok: true } | { ok: false; status: 409; message: string };

/**
 * Puts a failed, partial (or, for the listener, cancelled) job back in the queue. The worker resumes from its
 * saved progress and keeps the same series; ready episodes and those held for review are left as they are.
 */
export async function restartJob(ctx: AppContext, job: Job, allowed: readonly string[]): Promise<RestartResult> {
  if (!allowed.includes(job.status)) return { ok: false, status: 409, message: 'This series is still being built.' };
  // A fresh start for the rate-limit wait, too.
  const { rateLimitRetries: _r, rateLimitedSince: _s, ...state } = (job.state ?? {}) as Record<string, unknown>;
  const updated = await ctx.db
    .update(schema.generationJob)
    .set({ status: 'queued', attempts: 0, error: null, finishedAt: null, cancelRequested: 0, runAfter: ctx.now(), state })
    .where(and(eq(schema.generationJob.id, job.id), eq(schema.generationJob.status, job.status)))
    .returning({ id: schema.generationJob.id });
  if (!updated.length) return { ok: false, status: 409, message: 'This series is already being retried.' };
  if (job.seriesId) await ctx.db.update(schema.podcastSeries).set({ status: 'generating' }).where(eq(schema.podcastSeries.id, job.seriesId));
  ctx.pokeWorker();
  return { ok: true };
}
