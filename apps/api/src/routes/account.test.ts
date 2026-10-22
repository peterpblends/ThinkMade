import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createContext } from '../create-context';
import { loadEnv } from '../env';
import { createTestContext, signUpVerified } from '../test-helpers';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('account data export', () => {
  it('requires a session', async () => {
    ctx = await createTestContext();
    expect((await createApp(ctx).request('/api/me/export')).status).toBe(401);
  });

  it('returns the signed-in user data as a JSON attachment without secrets', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'exp@example.com' });
    const res = await app.request('/api/me/export', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="thinkmade-export-.*\.json"/);
    const body = await res.text();
    const data = JSON.parse(body) as Record<string, unknown>;
    expect(data).toHaveProperty('user.email', 'exp@example.com');
    expect(data).toHaveProperty('learningRequests');
    expect(data).toHaveProperty('exportedAt');
    expect(body).not.toMatch(/password|secret|token/i);
  });
});

describe('verification links', () => {
  it('point at the public app origin so cookies land on the app domain', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
      body: JSON.stringify({ email: 'link@example.com', password: 'correct-horse-battery', name: 'L' }),
    });
    expect(ctx.email.sent[0]!.text).toContain(`${ctx.env.APP_URL}/api/auth/verify-email?token=`);
  });
});

describe('test-only email endpoint', () => {
  it('returns the last email to an address in the test environment', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    await ctx.email.send({ to: 'a@example.com', subject: 's', text: 'first' });
    await ctx.email.send({ to: 'a@example.com', subject: 's', text: 'second' });
    const res = await app.request('/api/_test/last-email?to=a@example.com');
    expect(await res.json()).toEqual({ to: 'a@example.com', subject: 's', text: 'second' });
  });

  it('does not exist outside the test environment', async () => {
    const env = loadEnv({ NODE_ENV: 'development', AUTH_SECRET: 'x'.repeat(40) });
    const dev = await createContext({ env, pgliteDir: ':memory:' });
    try {
      expect((await createApp(dev).request('/api/_test/last-email?to=a@example.com')).status).toBe(404);
    } finally {
      await dev.close();
    }
  });
});

describe('auth rate limit configuration', () => {
  it('honours AUTH_RATE_LIMIT', () => {
    expect(loadEnv({ NODE_ENV: 'test', AUTH_SECRET: 'x'.repeat(40), AUTH_RATE_LIMIT: '1000' }).AUTH_RATE_LIMIT).toBe(1000);
    expect(loadEnv({ NODE_ENV: 'test', AUTH_SECRET: 'x'.repeat(40) }).AUTH_RATE_LIMIT).toBe(20);
  });
});
