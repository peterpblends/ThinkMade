import { Hono } from 'hono';
import type { AppContext } from '../create-context';
import { requireAdmin, type AppVariables } from '../middleware/session';

/** Everything under /api/admin requires the admin role with two-factor enabled. */
export function adminRoutes(ctx: AppContext) {
  const admin = new Hono<{ Variables: AppVariables }>();
  admin.use('*', requireAdmin(ctx.db, ctx.env));
  admin.get('/whoami', (c) => c.json({ user: c.var.session!.user }));
  return admin;
}
