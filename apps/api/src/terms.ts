import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { schema, type Db } from '@thinkmade/db';
import { TERMS_VERSION } from '@thinkmade/shared';
import { requireSession, type AppVariables } from './middleware/session';

/** The visitor's IP address and browser, recorded with their agreement. */
export function requestOrigin(headers: Headers | undefined | null): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();
  return { ipAddress: forwarded || headers?.get('x-real-ip') || null, userAgent: headers?.get('user-agent')?.slice(0, 500) ?? null };
}

/** Records that a person agreed to the current terms. */
export async function recordTermsAcceptance(db: Db, userId: string, context: 'sign_up' | 'update', headers?: Headers | null): Promise<void> {
  await db.insert(schema.termsAcceptance).values({ id: crypto.randomUUID(), userId, version: TERMS_VERSION, context, ...requestOrigin(headers) });
}

/** Whether a person has agreed to the current terms. */
export async function hasAcceptedTerms(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.termsAcceptance.id })
    .from(schema.termsAcceptance)
    .where(and(eq(schema.termsAcceptance.userId, userId), eq(schema.termsAcceptance.version, TERMS_VERSION)))
    .limit(1);
  return !!row;
}

/** Making podcasts and coaching need agreement to the current terms (the app then asks for it). */
export function requireTerms(db: Db) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const s = c.var.session;
    if (!s) return c.json({ error: 'unauthenticated' }, 401);
    if (!(await hasAcceptedTerms(db, s.user.id))) {
      return c.json({ error: 'terms_required', version: TERMS_VERSION, message: 'Please review and agree to the updated Terms of Service to continue.' }, 403);
    }
    await next();
  });
}

/** The terms a signed-in person has agreed to, and agreeing to the current ones. */
export function termsRoutes(db: Db) {
  return new Hono<{ Variables: AppVariables }>()
    .get('/me/terms', requireSession(), async (c) => c.json({ version: TERMS_VERSION, accepted: await hasAcceptedTerms(db, c.var.session!.user.id) }))
    .post('/me/terms', requireSession(), async (c) => {
      const body = (await c.req.json().catch(() => null)) as { version?: unknown } | null;
      // Agreement is to a specific version: an out-of-date page can't agree to terms it didn't show.
      if (body?.version !== TERMS_VERSION) return c.json({ error: 'terms_version_mismatch', version: TERMS_VERSION, message: 'The terms have changed. Please review the latest version.' }, 409);
      const userId = c.var.session!.user.id;
      if (!(await hasAcceptedTerms(db, userId))) await recordTermsAcceptance(db, userId, 'update', c.req.raw.headers);
      return c.json({ version: TERMS_VERSION, accepted: true });
    });
}
