import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('cross-site request protection', () => {
  it('rejects a state-changing API request from another website', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'csrf@example.com' });
    const res = await app.request('/api/generations', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ topic: 'Forged request' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin' });
  });

  it('allows the same request from the app itself, and reads from anywhere', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'ok@example.com' });
    const ok = await app.request('/api/generations', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL }, body: JSON.stringify({ topic: 'Real request here' }) });
    expect(ok.status).toBe(202);
    expect((await app.request('/api/discover', { headers: { origin: 'https://elsewhere.example' } })).status).toBe(200);
  });

  it('rejects a cross-site form post that carries no Origin but a foreign Referer', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const res = await app.request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json', referer: 'https://evil.example/page' }, body: JSON.stringify({ description: 'forged' }) });
    expect(res.status).toBe(403);
  });
});
