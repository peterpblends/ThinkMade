import { createMiddleware } from 'hono/factory';

/**
 * Defence in depth against cross-site request forgery (session cookies are already SameSite=Lax):
 * state-changing requests must come from a trusted origin. Requests with neither Origin nor
 * Referer (server-to-server tools, older clients) are allowed, since browsers send one on cross-site posts.
 */
export function originCheck(trusted: string[]) {
  const allowed = new Set(trusted.map((u) => new URL(u).origin));
  return createMiddleware(async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    const origin = c.req.header('origin');
    const referer = c.req.header('referer');
    let source: string | null = null;
    if (origin && origin !== 'null') source = origin;
    else if (referer) {
      try {
        source = new URL(referer).origin;
      } catch {
        source = 'invalid';
      }
    } else if (origin === 'null') source = 'null';
    if (source !== null && !allowed.has(source)) return c.json({ error: 'forbidden_origin' }, 403);
    await next();
  });
}
