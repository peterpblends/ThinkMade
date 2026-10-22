import { describe, expect, it } from 'vitest';
import { createBrevoSender, createEmailSender, createResendSender } from './providers';

describe('Resend sender', () => {
  it('posts to the Resend API and returns the id', async () => {
    let req: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      req = { url, init };
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    }) as typeof fetch;
    const s = createResendSender({ apiKey: 'k', from: 'ThinkMade <hello@zicaworld.com>', fetch: fetchFn });
    expect(await s.send({ to: 'a@b.c', subject: 'S', text: 'T' })).toEqual({ ok: true, id: 're_1' });
    expect(req!.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(req!.init.body))).toMatchObject({ from: 'ThinkMade <hello@zicaworld.com>', to: ['a@b.c'], subject: 'S', text: 'T' });
  });

  it('reports failure instead of pretending', async () => {
    const fetchFn = (async () => new Response('{"message":"domain not verified"}', { status: 403 })) as typeof fetch;
    const r = await createResendSender({ apiKey: 'k', from: 'x@y.z', fetch: fetchFn }).send({ to: 'a@b.c', subject: 'S', text: 'T' });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/403/);
  });
});

describe('Brevo sender', () => {
  it('posts to the Brevo API', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ messageId: 'b1' }), { status: 201 });
    }) as typeof fetch;
    const r = await createBrevoSender({ apiKey: 'k', from: 'hello@zicaworld.com', fetch: fetchFn }).send({ to: 'a@b.c', subject: 'S', text: 'T' });
    expect(r).toEqual({ ok: true, id: 'b1' });
    expect(body).toMatchObject({ sender: { email: 'hello@zicaworld.com' }, to: [{ email: 'a@b.c' }], subject: 'S', textContent: 'T' });
  });
});

describe('createEmailSender', () => {
  it('picks Resend, then Brevo, then the console in development', () => {
    expect(createEmailSender({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.c' }).provider).toBe('resend');
    expect(createEmailSender({ BREVO_API_KEY: 'k', EMAIL_FROM: 'a@b.c' }).provider).toBe('brevo');
    expect(createEmailSender({ NODE_ENV: 'development' }).provider).toBe('console');
  });

  it('in production without a provider, every send fails honestly', async () => {
    const s = createEmailSender({ NODE_ENV: 'production' });
    expect(s.provider).toBe('none');
    expect(await s.send({ to: 'a@b.c', subject: 'S', text: 'T' })).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/) });
  });
});
