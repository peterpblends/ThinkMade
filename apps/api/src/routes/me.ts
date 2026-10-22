import { Hono } from 'hono';
import { requireSession, type AppVariables } from '../middleware/session';

export function meRoutes() {
  return new Hono<{ Variables: AppVariables }>().get('/me', requireSession(), (c) =>
    c.json({ user: c.var.session!.user }),
  );
}
