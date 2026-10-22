import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, signUpVerified } from './test-helpers';
import { createApp } from './app';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('app', () => {
  it('health responds with security headers', async () => {
    ctx = await createTestContext();
    const res = await createApp(ctx).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: 'pglite' });
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('me requires a session', async () => {
    ctx = await createTestContext();
    const res = await createApp(ctx).request('/api/me');
    expect(res.status).toBe(401);
  });

  it('me returns the signed-in user', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'bea@example.com' });
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; emailVerified: boolean } };
    expect(body.user).toMatchObject({ email: 'bea@example.com', emailVerified: true });
  });

  it('admin route forbids a non-admin', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'cy@example.com' });
    expect((await app.request('/api/admin/whoami', { headers: { cookie } })).status).toBe(403);
  });

  it('admin route forbids an admin without two-factor', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'di@example.com', role: 'admin' });
    const res = await app.request('/api/admin/whoami', { headers: { cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'two_factor_required' });
  });

  it('admin route allows an admin with two-factor', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, {
      email: 'ed@example.com',
      role: 'admin',
      twoFactorEnabled: true,
    });
    expect((await app.request('/api/admin/whoami', { headers: { cookie } })).status).toBe(200);
  });

  it('auth POST requests are rate limited per IP', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL, 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-1' }),
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
