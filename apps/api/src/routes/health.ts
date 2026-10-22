import { Hono } from 'hono';
import type { AppContext } from '../create-context';

export function healthRoutes(ctx: AppContext) {
  return new Hono().get('/health', (c) =>
    c.json({ ok: true, version: ctx.env.APP_VERSION, db: ctx.dbKind }),
  );
}
