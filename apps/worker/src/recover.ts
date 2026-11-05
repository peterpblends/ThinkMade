import { sql } from 'drizzle-orm';
import { queryRows, type Db } from '@thinkmade/db';

/**
 * Podcasts that an old, series-wide language-model budget stopped part-way are started again, once each:
 * the episodes already made are kept, and the unfinished ones are written with the per-episode allowances
 * that replaced that budget (so it can't stop a series again). Runs when the worker starts.
 */
export async function recoverBudgetStops(db: Db, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await queryRows<{ id: string; series_id: string | null }>(
    db,
    sql`update generation_job set
          status = 'queued', attempts = 0, error = null, finished_at = null, run_after = ${now},
          locked_by = null, locked_until = null, cancel_requested = 0,
          state = (state - 'tokens' - 'rateLimitRetries' - 'rateLimitedSince' - 'autoRestarts') || '{"budgetRecovered": true}'::jsonb,
          updated_at = ${now}
        where status in ('failed', 'partial')
          and error like '%language-model budget%'
          and coalesce(finished_at, updated_at) >= ${since}
          and not (state ? 'budgetRecovered')
        returning id, series_id`,
  );
  for (const r of rows) {
    if (r.series_id) await db.execute(sql`update podcast_series set status = 'generating' where id = ${r.series_id}`);
  }
  return rows.length;
}
