import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import * as schema from '../schema/index';

const UNFINISHED = ['pending', 'scripting', 'validating', 'synthesizing'];

/**
 * Tidies a series after its job is cancelled. Episodes that were still being made are removed (the job keeps
 * its plan, so trying again recreates them), except a replacement for a rejected episode, which goes back to
 * "rejected". The series is then ready, partial or failed by what is left. Safe to run more than once.
 */
export async function settleCancelledSeries(db: Db, seriesId: string): Promise<void> {
  const unfinished = await db
    .select({ id: schema.episode.id })
    .from(schema.episode)
    .where(and(eq(schema.episode.seriesId, seriesId), inArray(schema.episode.status, UNFINISHED)));
  if (unfinished.length) {
    const ids = unfinished.map((e) => e.id);
    const rejected = new Set(
      (
        await db
          .select({ id: schema.episodeQualityCheck.episodeId })
          .from(schema.episodeQualityCheck)
          .where(and(inArray(schema.episodeQualityCheck.episodeId, ids), eq(schema.episodeQualityCheck.checkedBy, 'human'), eq(schema.episodeQualityCheck.passed, 0)))
      ).map((r) => r.id),
    );
    if (rejected.size) await db.update(schema.episode).set({ status: 'rejected' }).where(inArray(schema.episode.id, [...rejected]));
    const drop = ids.filter((id) => !rejected.has(id));
    if (drop.length) await db.delete(schema.episode).where(inArray(schema.episode.id, drop));
  }
  const left = (await db.select({ status: schema.episode.status }).from(schema.episode).where(eq(schema.episode.seriesId, seriesId))).filter((e) => e.status !== 'rejected');
  const ready = left.filter((e) => e.status === 'ready').length;
  const status = ready === 0 ? 'failed' : ready === left.length ? 'ready' : 'partial';
  await db.update(schema.podcastSeries).set({ status }).where(eq(schema.podcastSeries.id, seriesId));
}

/**
 * Cancels a queued or running job straight away. A worker running it loses its lease, notices within seconds
 * and stops without writing a result. Returns false if the job had already finished.
 */
export async function cancelJob(db: Db, jobId: string): Promise<boolean> {
  const [job] = await db
    .update(schema.generationJob)
    .set({ status: 'cancelled', cancelRequested: 1, error: 'Cancelled.', finishedAt: new Date(), lockedBy: null, lockedUntil: null })
    .where(and(eq(schema.generationJob.id, jobId), inArray(schema.generationJob.status, ['queued', 'running'])))
    .returning({ seriesId: schema.generationJob.seriesId });
  if (!job) return false;
  if (job.seriesId) await settleCancelledSeries(db, job.seriesId);
  return true;
}
