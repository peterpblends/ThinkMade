import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../create-context';

export function healthRoutes(ctx: AppContext) {
  return new Hono().get('/health', async (c) => {
    // ?warm=1: also open the database connection and load settings, so a live conversation's next request
    // doesn't pay for a cold start.
    if (c.req.query('warm')) await Promise.all([ctx.db.execute(sql`select 1`), ctx.settings.getActive()]).catch(() => {});
    return c.json({ ok: true, version: ctx.env.APP_VERSION, db: ctx.dbKind });
  });
}
