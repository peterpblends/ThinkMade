import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { TERMS_VERSION } from '@thinkmade/shared';
import { createApp } from './app';
import { createTestContext, signUpVerified } from './test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('agreeing to the terms', () => {
  it('asks an account without agreement to the current terms to agree before making podcasts or coaching', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'older@example.com' });
    const json = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    // An account from before these terms (or before a new version): no agreement on record.
    await ctx.db.delete(schema.termsAcceptance);

    expect(await (await app.request('/api/me/terms', { headers: json })).json()).toEqual({ version: TERMS_VERSION, accepted: false });
    const blocked = await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'Better decisions' }) });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: 'terms_required', version: TERMS_VERSION });
    expect((await app.request('/api/planner', { method: 'POST', headers: json, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], current: {} }) })).status).toBe(403);

    // Agreeing counts only for the version the page showed.
    const stale = await app.request('/api/me/terms', { method: 'POST', headers: json, body: JSON.stringify({ version: '2020-01-01' }) });
    expect(stale.status).toBe(409);
    const agreed = await app.request('/api/me/terms', { method: 'POST', headers: { ...json, 'user-agent': 'Phone/2.0' }, body: JSON.stringify({ version: TERMS_VERSION }) });
    expect(await agreed.json()).toEqual({ version: TERMS_VERSION, accepted: true });
    const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'older@example.com'));
    expect(await ctx.db.select().from(schema.termsAcceptance).where(eq(schema.termsAcceptance.userId, user!.id))).toEqual([expect.objectContaining({ version: TERMS_VERSION, context: 'update', userAgent: 'Phone/2.0' })]);

    expect((await app.request('/api/generations', { method: 'POST', headers: json, body: JSON.stringify({ topic: 'Better decisions' }) })).status).toBe(202);
  });

  it('needs a session', async () => {
    ctx = await createTestContext();
    expect((await createApp(ctx).request('/api/me/terms')).status).toBe(401);
  });
});
