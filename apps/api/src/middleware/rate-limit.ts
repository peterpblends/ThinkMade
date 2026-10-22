import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { queryRows, type Db } from '@thinkmade/db';

export interface RateLimitOptions {
  db: Db;
  /** Namespace so different limits on the same key do not share a counter. */
  name: string;
  key: (c: Context) => string;
  limit: number;
  windowSeconds: number;
  now?: () => Date;
}

/** Best-effort client IP. Vercel and most proxies put the client first in x-forwarded-for. */
export function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Fixed-window counter stored in Postgres so limits hold across serverless instances.
 * One atomic upsert per request.
 */
export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const now = (opts.now ?? (() => new Date()))();
    const windowStartCutoff = new Date(now.getTime() - opts.windowSeconds * 1000);
    const key = `${opts.name}:${opts.key(c)}`;
    const rows = await queryRows<{ count: number; window_start: Date | string }>(
      opts.db,
      sql`insert into rate_limit (key, window_start, count) values (${key}, ${now.toISOString()}, 1)
          on conflict (key) do update set
            count = case when rate_limit.window_start <= ${windowStartCutoff.toISOString()} then 1 else rate_limit.count + 1 end,
            window_start = case when rate_limit.window_start <= ${windowStartCutoff.toISOString()} then ${now.toISOString()}::timestamptz else rate_limit.window_start end
          returning count, window_start`,
    );
    const row = rows[0]!;
    if (row.count > opts.limit) {
      const started = new Date(row.window_start).getTime();
      const retryAfter = Math.max(1, Math.ceil((started + opts.windowSeconds * 1000 - now.getTime()) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'rate_limited', retryAfterSeconds: retryAfter }, 429);
    }
    await next();
  });
}
