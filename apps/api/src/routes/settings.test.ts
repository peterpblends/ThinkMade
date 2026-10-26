import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('settings routes', () => {
  it('public settings need no auth and expose no bug-report email or limits', async () => {
    ctx = await createTestContext();
    const res = await createApp(ctx).request('/api/settings/public');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('podcast.defaultLengthMinutes', 15);
    expect(body).toHaveProperty('podcast.lengthChoices');
    expect(JSON.stringify(body)).not.toContain('bugReports');
    expect(body).not.toHaveProperty('limits');
  });

  it('an admin can update settings and read them back', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'root@example.com', role: 'admin', twoFactorEnabled: true });
    const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    const put = await app.request('/api/admin/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ patch: { podcast: { defaultEpisodes: 5 } }, note: 'test' }),
    });
    expect(put.status).toBe(200);
    const get = await app.request('/api/admin/settings', { headers });
    expect(await get.json()).toMatchObject({ version: 2, settings: { podcast: { defaultEpisodes: 5 } } });
    const versions = await app.request('/api/admin/settings/versions', { headers });
    expect(((await versions.json()) as { versions: unknown[] }).versions).toHaveLength(2);
    const rollback = await app.request('/api/admin/settings/rollback', {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: 1 }),
    });
    expect(await rollback.json()).toMatchObject({ version: 3, settings: { podcast: { defaultEpisodes: 3 } } });
  });

  it('an invalid patch returns 400 with issues', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'root2@example.com', role: 'admin', twoFactorEnabled: true });
    const res = await app.request('/api/admin/settings', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL },
      body: JSON.stringify({ patch: { podcast: { defaultEpisodes: 0 } } }),
    });
    expect(res.status).toBe(400);
  });

  it("an admin sets the opening splash's length, which visitors receive", async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'root@example.com', role: 'admin', twoFactorEnabled: true });
    const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    const before = (await (await app.request('/api/settings/public')).json()) as { splash: { seconds: number } };
    expect(before.splash.seconds).toBe(2.3);
    const put = await app.request('/api/admin/settings', { method: 'PUT', headers, body: JSON.stringify({ patch: { appearance: { splashSeconds: 4.5 } } }) });
    expect(put.status).toBe(200);
    const after = (await (await app.request('/api/settings/public')).json()) as { splash: { seconds: number } };
    expect(after.splash.seconds).toBe(4.5);
    for (const bad of [-1, 11]) {
      const res = await app.request('/api/admin/settings', { method: 'PUT', headers, body: JSON.stringify({ patch: { appearance: { splashSeconds: bad } } }) });
      expect(res.status).toBe(400);
    }
  });

  it('a normal user cannot read admin settings', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'user@example.com' });
    expect((await app.request('/api/admin/settings', { headers: { cookie } })).status).toBe(403);
  });
});
