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
