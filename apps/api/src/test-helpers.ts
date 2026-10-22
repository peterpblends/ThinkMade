import { createDb, runMigrations, type DbHandle } from '@thinkmade/db';
import { memoryEmailSender } from '@thinkmade/ai';
import { createAuth } from './auth';
import { loadEnv } from './env';

export const TEST_ORIGIN = 'http://localhost:5173';

export async function makeAuthHarness() {
  const handle: DbHandle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
  const env = loadEnv({ NODE_ENV: 'test', AUTH_SECRET: 'test-secret-test-secret-test-secret-00' });
  const email = memoryEmailSender();
  const auth = createAuth({ db: handle.db, env, email });
  return { handle, env, email, auth };
}

/** Builds a request to the auth handler with the trusted Origin header set. */
export function authRequest(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ origin: TEST_ORIGIN });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`http://localhost:8787${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

export function extractUrl(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no URL in: ${text}`);
  return match[0];
}

/** Collapses set-cookie headers into a Cookie header value. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import type { Hono } from 'hono';
import { createContext } from './create-context';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';

/** App context on an in-memory database with a capturing email sender. */
export async function createTestContext() {
  const env = loadEnv({ NODE_ENV: 'test', AUTH_SECRET: 'test-secret-test-secret-test-secret-00' });
  const email = memoryEmailSender();
  const ctx = await createContext({ env, email, pgliteDir: ':memory:' });
  return { ...ctx, email };
}

/**
 * Signs up through the real auth routes, applies role/two-factor flags directly in the database,
 * follows the verification link, signs in, and returns the session cookie.
 */
export async function signUpVerified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: Hono<any>,
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  opts: { email: string; password?: string; role?: string; twoFactorEnabled?: boolean },
): Promise<string> {
  const password = opts.password ?? 'correct-horse-battery';
  const headers = { 'content-type': 'application/json', origin: ctx.env.APP_URL };
  const signUp = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: opts.email, password, name: 'Test User' }),
  });
  if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status}`);
  if (opts.role) {
    await ctx.db.update(schema.user).set({ role: opts.role }).where(eq(schema.user.email, opts.email));
  }
  const message = [...ctx.email.sent].reverse().find((m) => m.to === opts.email);
  const link = new URL(extractUrl(message!.text));
  await app.request(link.pathname + link.search, { headers: { origin: ctx.env.APP_URL } });
  const signIn = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: opts.email, password }),
  });
  if (signIn.status !== 200) throw new Error(`sign-in failed: ${signIn.status}`);
  const cookie = cookieFrom(signIn);
  if (opts.twoFactorEnabled) await enrollTotp(app, ctx, cookie, password);
  return cookie;
}

/** Enrolls TOTP through the real two-factor endpoints, as an authenticator app would. */
export async function enrollTotp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: Hono<any>,
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  cookie: string,
  password: string,
): Promise<void> {
  const headers = { 'content-type': 'application/json', origin: ctx.env.APP_URL, cookie };
  const enable = await app.request('/api/auth/two-factor/enable', {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  });
  if (enable.status !== 200) throw new Error(`2fa enable failed: ${enable.status} ${await enable.text()}`);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secretB32 = new URL(totpURI).searchParams.get('secret')!;
  const secret = new TextDecoder().decode(base32.decode(secretB32));
  const code = await createOTP(secret).totp();
  const verify = await app.request('/api/auth/two-factor/verify-totp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  });
  if (verify.status !== 200) throw new Error(`2fa verify failed: ${verify.status} ${await verify.text()}`);
}
