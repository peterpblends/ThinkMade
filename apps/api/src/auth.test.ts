import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { TERMS_VERSION } from '@thinkmade/shared';
import { authRequest, cookieFrom, extractUrl, makeAuthHarness } from './test-helpers';

type Harness = Awaited<ReturnType<typeof makeAuthHarness>>;
let h: Harness | undefined;

afterEach(async () => {
  await h?.handle.close();
  h = undefined;
});

const creds = { email: 'ada@example.com', password: 'correct-horse-battery', name: 'Ada', acceptTerms: TERMS_VERSION };

describe('auth', () => {
  it('sign up sends a verification email and blocks sign-in until verified', async () => {
    h = await makeAuthHarness();
    const signUp = await h.auth.handler(authRequest('/api/auth/sign-up/email', { body: creds }));
    expect(signUp.status).toBe(200);
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.to).toBe(creds.email);
    const link = extractUrl(h.email.sent[0]!.text);
    expect(link).toContain('token=');

    const blocked = await h.auth.handler(
      authRequest('/api/auth/sign-in/email', { body: { email: creds.email, password: creds.password } }),
    );
    expect(blocked.status).toBe(403);

    const verify = await h.auth.handler(new Request(link, { headers: { origin: 'http://localhost:5173' } }));
    expect([200, 302]).toContain(verify.status);

    const ok = await h.auth.handler(
      authRequest('/api/auth/sign-in/email', { body: { email: creds.email, password: creds.password } }),
    );
    expect(ok.status).toBe(200);
    expect(cookieFrom(ok)).toMatch(/session_token=/);
  });

  it('makes ADMIN_EMAILS administrators only after they verify the address', async () => {
    h = await makeAuthHarness({ ADMIN_EMAILS: 'someone@example.com, ADA@example.com' });
    const { schema } = await import('@thinkmade/db');
    const { eq } = await import('drizzle-orm');
    const role = async () => (await h!.handle.db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.email, creds.email)))[0]?.role;
    await h.auth.handler(authRequest('/api/auth/sign-up/email', { body: creds }));
    expect((await role()) ?? 'user').not.toContain('admin');
    await h.auth.handler(new Request(extractUrl(h.email.sent[0]!.text), { headers: { origin: 'http://localhost:5173' } }));
    expect(await role()).toBe('admin');

    await h.auth.handler(authRequest('/api/auth/sign-up/email', { body: { ...creds, email: 'other@example.com' } }));
    await h.auth.handler(new Request(extractUrl(h.email.sent.at(-1)!.text), { headers: { origin: 'http://localhost:5173' } }));
    const [other] = await h.handle.db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.email, 'other@example.com'));
    expect(other?.role ?? 'user').not.toContain('admin');
  });

  it('rejects passwords shorter than 10 characters', async () => {
    h = await makeAuthHarness();
    const res = await h.auth.handler(
      authRequest('/api/auth/sign-up/email', { body: { ...creds, password: 'short1' } }),
    );
    expect(res.status).toBe(400);
  });

  it('sends a password reset email for an existing account', async () => {
    h = await makeAuthHarness();
    await h.auth.handler(authRequest('/api/auth/sign-up/email', { body: creds }));
    const res = await h.auth.handler(
      authRequest('/api/auth/request-password-reset', {
        body: { email: creds.email, redirectTo: 'http://localhost:5173/reset-password' },
      }),
    );
    expect(res.status).toBe(200);
    const reset = h.email.sent.find((m) => m.subject.toLowerCase().includes('reset'));
    expect(reset).toBeDefined();
  });

  it('creates an account only when the person agreed to the current terms, and records the agreement', async () => {
    h = await makeAuthHarness();
    const { acceptTerms: _a, ...noTerms } = creds;
    for (const body of [noTerms, { ...creds, acceptTerms: true }, { ...creds, acceptTerms: '2020-01-01' }]) {
      const res = await h.auth.handler(authRequest('/api/auth/sign-up/email', { body }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toMatch(/agree to the Terms of Service/);
    }
    expect(await h.handle.db.select().from(schema.user)).toHaveLength(0);

    const req = authRequest('/api/auth/sign-up/email', { body: creds });
    req.headers.set('x-forwarded-for', '203.0.113.7, 10.0.0.1');
    req.headers.set('user-agent', 'TestBrowser/1.0');
    expect((await h.auth.handler(req)).status).toBe(200);
    const [user] = await h.handle.db.select().from(schema.user).where(eq(schema.user.email, creds.email));
    const rows = await h.handle.db.select().from(schema.termsAcceptance).where(eq(schema.termsAcceptance.userId, user!.id));
    expect(rows).toEqual([expect.objectContaining({ version: TERMS_VERSION, context: 'sign_up', ipAddress: '203.0.113.7', userAgent: 'TestBrowser/1.0' })]);
    expect(rows[0]!.acceptedAt).toBeInstanceOf(Date);
  });
});
