import { sql } from 'drizzle-orm';
import { queryRows, type Db } from '@thinkmade/db';

export type ClaimedJob = {
  id: string;
  user_id: string;
  learning_request_id: string;
  series_id: string | null;
  attempts: number;
  max_attempts: number;
  options: Record<string, unknown>;
  state: Record<string, unknown>;
};

/**
 * Atomically claims the oldest runnable job: queued and due, or running with an expired lease
 * (its worker died). Respects a global concurrency limit. Returns null when there is nothing to do.
 */
export async function claimNextJob(db: Db, workerId: string, opts: { leaseSeconds: number; concurrency: number }): Promise<ClaimedJob | null> {
  if (opts.concurrency <= 0) return null;
  const [busy] = await queryRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from generation_job where status = 'running' and locked_until > now()`,
  );
  if ((busy?.n ?? 0) >= opts.concurrency) return null;
  const rows = await queryRows<ClaimedJob>(
    db,
    sql`update generation_job set
          status = 'running',
          locked_by = ${workerId},
          locked_until = now() + make_interval(secs => ${opts.leaseSeconds}),
          attempts = attempts + 1,
          started_at = coalesce(started_at, now()),
          updated_at = now()
        where id = (
          select id from generation_job
          where (status = 'queued' and run_after <= now())
             or (status = 'running' and locked_until < now())
          order by created_at
          for update skip locked
          limit 1
        )
        returning id, user_id, learning_request_id, series_id, attempts, max_attempts, options, state`,
  );
  return rows[0] ?? null;
}

/** Extends the lease while long work (script writing, speech) is in progress. */
export async function extendLease(db: Db, jobId: string, workerId: string, leaseSeconds: number) {
  await db.execute(
    sql`update generation_job set locked_until = now() + make_interval(secs => ${leaseSeconds})
        where id = ${jobId} and locked_by = ${workerId}`,
  );
}

/** Puts a job back in the queue after a temporary failure. */
export async function requeueJob(db: Db, jobId: string, delaySeconds: number, error: string, countAttempt = true, workerId?: string) {
  await db.execute(
    sql`update generation_job set status = 'queued', locked_by = null, locked_until = null,
          run_after = now() + make_interval(secs => ${delaySeconds}),
          attempts = attempts - ${countAttempt ? 0 : 1},
          error = ${error}, updated_at = now()
        where id = ${jobId} ${workerId ? sql`and locked_by = ${workerId}` : sql``}`,
  );
}
