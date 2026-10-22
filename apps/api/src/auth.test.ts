import { afterEach, describe, expect, it } from 'vitest';
import { authRequest, cookieFrom, extractUrl, makeAuthHarness } from './test-helpers';

type Harness = Awaited<ReturnType<typeof makeAuthHarness>>;
let h: Harness | undefined;

afterEach(async () => {
  await h?.handle.close();
  h = undefined;
});

const creds = { email: 'ada@example.com', password: 'correct-horse-battery', name: 'Ada' };

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
});
