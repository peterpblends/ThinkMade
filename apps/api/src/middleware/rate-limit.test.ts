import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDb, runMigrations, type DbHandle } from '@thinkmade/db';
import { rateLimit } from './rate-limit';

let handle: DbHandle;
beforeAll(async () => {
  handle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
});
afterAll(() => handle.close());

function appWith(now: () => Date) {
  const app = new Hono();
  app.use('*', rateLimit({ db: handle.db, name: 't', key: () => 'k1', limit: 3, windowSeconds: 60, now }));
  app.get('/', (c) => c.text('ok'));
  return app;
}

describe('rateLimit', () => {
  it('returns 429 with Retry-After after the limit within the window', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const app = appWith(() => t0);
    for (let i = 0; i < 3; i++) expect((await app.request('/')).status).toBe(200);
    const blocked = await app.request('/');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('resets once the window has passed', async () => {
    const later = new Date('2026-01-01T00:02:00Z');
    const app = appWith(() => later);
    expect((await app.request('/')).status).toBe(200);
  });
});
