import { Hono } from 'hono';
import type { EmailMessage } from '@thinkmade/ai';
import type { AppContext } from '../create-context';

/** Mounted only when NODE_ENV=test. Lets end-to-end tests read verification emails. */
export function testOnlyRoutes(ctx: AppContext) {
  const r = new Hono();
  r.get('/last-email', (c) => {
    const sent = (ctx.email as { sent?: EmailMessage[] }).sent;
    const to = c.req.query('to');
    const message = sent && [...sent].reverse().find((m) => m.to === to);
    if (!message) return c.json({ error: 'not_found' }, 404);
    return c.json({ to: message.to, subject: message.subject, text: message.text });
  });
  r.post('/make-admin', async (c) => {
    const email = c.req.query('email') ?? '';
    const { eq } = await import('drizzle-orm');
    const { schema } = await import('@thinkmade/db');
    const updated = await ctx.db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.email, email)).returning({ id: schema.user.id });
    return updated.length ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });
  return r;
}
