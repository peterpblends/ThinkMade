import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { schema, type Db } from '@thinkmade/db';
import type { Auth } from '../auth';
import type { Env } from '../env';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string | null;
  twoFactorEnabled: boolean;
}

export interface SessionData {
  user: SessionUser;
  sessionId: string;
}

export type AppVariables = { session: SessionData | null };

/** Loads the Better Auth session (if any) into c.var.session. Never rejects. */
export function loadSession(auth: Auth) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (result) {
      const u = result.user as typeof result.user & { role?: string | null; twoFactorEnabled?: boolean | null };
      c.set('session', {
        sessionId: result.session.id,
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          emailVerified: u.emailVerified,
          role: u.role ?? null,
          twoFactorEnabled: Boolean(u.twoFactorEnabled),
        },
      });
    } else {
      c.set('session', null);
    }
    await next();
  });
}

export function requireSession() {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    if (!c.var.session) return c.json({ error: 'unauthenticated' }, 401);
    await next();
  });
}

export function requireVerified() {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const s = c.var.session;
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    if (!s.user.emailVerified) return c.json({ error: 'email_not_verified' }, 403);
    await next();
  });
}

/**
 * Whether this user may use admin tools right now: an administrator, verified, not banned, with two-step
 * verification on (or the development-only override). Read from the database, so a revoked role takes effect at once.
 */
export async function adminAccess(db: Db, env: Env, userId: string): Promise<'ok' | 'forbidden' | 'two_factor_required'> {
  const [row] = await db
    .select({ role: schema.user.role, twoFactorEnabled: schema.user.twoFactorEnabled, banned: schema.user.banned, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const roles = (row?.role ?? '').split(',').map((r) => r.trim());
  if (!row || row.banned || !row.emailVerified || !roles.includes('admin')) return 'forbidden';
  if (!row.twoFactorEnabled) {
    if (!(env.ADMIN_SKIP_2FA && env.NODE_ENV !== 'production')) return 'two_factor_required';
    console.warn('[admin] ADMIN_SKIP_2FA is set: allowing admin access without two-factor (development only).');
  }
  return 'ok';
}

/**
 * Admin guard. Reads role and two-factor state from the database rather than the session
 * cookie cache, so a revoked role takes effect immediately.
 */
export function requireAdmin(db: Db, env: Env) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const s = c.var.session;
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    const access = await adminAccess(db, env, s.user.id);
    if (access === 'forbidden') return c.json({ error: 'forbidden' }, 403);
    if (access === 'two_factor_required') {
      return c.json({ error: 'two_factor_required' }, 403);
    }
    await next();
  });
}
