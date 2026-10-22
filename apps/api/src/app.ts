import { Hono } from 'hono';
import type { AppContext } from './create-context';
import { clientIp, rateLimit } from './middleware/rate-limit';
import { securityHeaders } from './middleware/security-headers';
import { loadSession, type AppVariables } from './middleware/session';
import { adminRoutes } from './routes/admin';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { publicSettingsRoutes } from './routes/settings';

export function createApp(ctx: AppContext) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', securityHeaders());

  // Auth: throttle credential-bearing POSTs per IP, then hand everything to Better Auth.
  const authLimiter = rateLimit({
    db: ctx.db,
    name: 'auth',
    key: clientIp,
    limit: 20,
    windowSeconds: 15 * 60,
    now: ctx.now,
  });
  app.on('POST', '/api/auth/*', authLimiter);
  app.on(['GET', 'POST'], '/api/auth/*', (c) => ctx.auth.handler(c.req.raw));

  const api = new Hono<{ Variables: AppVariables }>();
  api.use('*', loadSession(ctx.auth));
  api.use(
    '*',
    rateLimit({
      db: ctx.db,
      name: 'api',
      key: (c) => (c.var as AppVariables).session?.user.id ?? clientIp(c),
      limit: 300,
      windowSeconds: 15 * 60,
      now: ctx.now,
    }),
  );
  api.route('/', healthRoutes(ctx));
  api.route('/', meRoutes());
  api.route('/', publicSettingsRoutes(ctx));
  api.route('/admin', adminRoutes(ctx));
  api.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.route('/api', api);

  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
