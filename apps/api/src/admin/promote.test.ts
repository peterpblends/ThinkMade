import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';
import { promoteToAdmin } from './promote';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('promoteToAdmin', () => {
  it('grants the admin role to an existing verified user and records an audit entry', async () => {
    ctx = await createTestContext();
    await signUpVerified(createApp(ctx), ctx, { email: 'owner@example.com' });
    await promoteToAdmin(ctx.db, 'owner@example.com');
    const [u] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, 'owner@example.com'));
    expect(u?.role).toBe('admin');
    const audits = await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'user.promote_admin'));
    expect(audits).toHaveLength(1);
  });

  it('refuses an unknown email', async () => {
    ctx = await createTestContext();
    await expect(promoteToAdmin(ctx.db, 'ghost@example.com')).rejects.toThrow(/No user/);
  });

  it('refuses an unverified user', async () => {
    ctx = await createTestContext();
    await createApp(ctx).request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
      body: JSON.stringify({ email: 'new@example.com', password: 'correct-horse-battery', name: 'N' }),
    });
    await expect(promoteToAdmin(ctx.db, 'new@example.com')).rejects.toThrow(/not verified/);
  });
});
