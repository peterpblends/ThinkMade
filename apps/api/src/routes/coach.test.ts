import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setFakeResponder, textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { fakeResponder, runNextJob } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  setFakeResponder(fakeResponder);
  await ctx?.close();
  ctx = undefined;
});

async function withEpisode() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'coach@example.com' });
  const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  await app.request('/api/generations', { method: 'POST', headers, body: JSON.stringify({ topic: 'Why does my team miss deadlines?', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
  await runNextJob(ctx.worker!);
  const [ep] = await ctx.db.select().from(schema.episode);
  return { app, cookie, headers, ep: ep! };
}

describe('Coach Me', () => {
  it('answers with the episode, its model, the original question and the transcript in context', async () => {
    const { app, headers, ep } = await withEpisode();
    let seen: ChatMessage[] = [];
    setFakeResponder((m) => {
      if (textOf(m[0]!.content).startsWith('STAGE: coach')) {
        seen = m;
        return 'Start by naming the alternative you are giving up.';
      }
      return fakeResponder(m);
    });
    const res = await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'How do I spot this at work?' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reply: { role: 'coach', content: 'Start by naming the alternative you are giving up.' } });
    const system = textOf(seen[0]!.content);
    expect(system).toContain('Why does my team miss deadlines?');
    expect(system).toContain(ep.title);
    expect(system).toMatch(/Transcript excerpts/);
    // The listener's words are a user message, never part of the instructions.
    expect(seen.at(-1)).toEqual({ role: 'user', content: 'How do I spot this at work?' });
  });

  it('answers briefly, to be spoken, in a hands-free conversation, knowing where it was interrupted', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    let seen: ChatMessage[] = [];
    setFakeResponder((m) => (textOf(m[0]!.content).startsWith('STAGE: coach') ? ((seen = m), 'Good. What would you give up first?') : fakeResponder(m)));
    const res = await app.request(`/api/coach/${ep.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Wait, what about my manager?', spoken: true, interruptedAfter: 'The first thing to notice is' }),
    });
    expect(res.status).toBe(200);
    expect(textOf(seen[0]!.content)).toContain('This is a live spoken conversation');
    expect(seen.at(-1)!.content).toBe('(I interrupted you after you said: "The first thing to notice is")\n\nWait, what about my manager?');
    // The saved conversation keeps the listener's own words.
    const hist = (await (await app.request(`/api/coach/${ep.id}`, { headers: { cookie } })).json()) as { messages: Array<{ content: string }> };
    expect(hist.messages.map((m) => m.content)).toEqual(['Wait, what about my manager?', 'Good. What would you give up first?']);

    // A typed question is not told to be brief.
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Typed question' }) });
    expect(textOf(seen[0]!.content)).not.toContain('This is a live spoken conversation');

    const [owner] = await ctx!.db.select().from(schema.user).where(eq(schema.user.email, 'coach@example.com'));
    await ctx!.settings.update({ features: { voiceCoaching: false } }, { id: owner!.id });
    const off = await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Hello?', spoken: true }) });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ feature: 'voiceCoaching' });
    expect((await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Typed still works' }) })).status).toBe(200);
  });

  it('coaches in the language the podcast was made in', async () => {
    ctx = await createTestContext();
    const app = createApp(ctx);
    const cookie = await signUpVerified(app, ctx, { email: 'es@example.com' });
    const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
    await app.request('/api/generations', { method: 'POST', headers, body: JSON.stringify({ topic: '¿Por qué mi equipo no cumple los plazos?', language: 'es', customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    await runNextJob(ctx.worker!);
    const [ep] = await ctx.db.select().from(schema.episode);
    expect(await (await app.request(`/api/coach/${ep!.id}`, { headers: { cookie } })).json()).toMatchObject({ language: 'es', speechLang: 'es-MX' });
    let seen: ChatMessage[] = [];
    setFakeResponder((m) => (textOf(m[0]!.content).startsWith('STAGE: coach') ? ((seen = m), 'Claro. ¿Qué harías primero?') : fakeResponder(m)));
    await app.request(`/api/coach/${ep!.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '¿Cómo empiezo?' }) });
    expect(textOf(seen[0]!.content)).toMatch(/This podcast is in Spanish \(Español\)/);
  });

  it('keeps history privately and resumes it', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'First question' }) });
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Second question' }) });
    const hist = (await (await app.request(`/api/coach/${ep.id}`, { headers: { cookie } })).json()) as { messages: Array<{ role: string; content: string }> };
    expect(hist.messages.map((m) => m.role)).toEqual(['user', 'coach', 'user', 'coach']);
    expect(hist.messages[2]!.content).toBe('Second question');

    const other = await signUpVerified(app, ctx!, { email: 'peek@example.com' });
    expect((await app.request(`/api/coach/${ep.id}`, { headers: { cookie: other } })).status).toBe(404);
  });

  it('passes earlier turns back to the coach', async () => {
    const { app, headers, ep } = await withEpisode();
    let last: ChatMessage[] = [];
    setFakeResponder((m) => (textOf(m[0]!.content).startsWith('STAGE: coach') ? ((last = m), 'ok') : fakeResponder(m)));
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Earlier question' }) });
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Follow-up' }) });
    expect(last.slice(1).map((m) => [m.role, m.content])).toEqual([
      ['user', 'Earlier question'],
      ['assistant', 'ok'],
      ['user', 'Follow-up'],
    ]);
  });

  it('says honestly when the coach model is not configured', async () => {
    const { app, headers, ep } = await withEpisode();
    await ctx!.db.update(schema.aiModelConfig).set({ provider: 'groq', model: 'x' }).where(eq(schema.aiModelConfig.stage, 'coach'));
    const res = await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Hello?' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'coach_unavailable' });
  });

  it('rejects empty and oversized questions', async () => {
    const { app, headers, ep } = await withEpisode();
    expect((await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: '   ' }) })).status).toBe(400);
    expect((await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'x'.repeat(2001) }) })).status).toBe(400);
  });

  it('creates a new podcast from a coaching conversation', async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'How would this work for hiring decisions?' }) });
    const { session } = (await (await app.request(`/api/coach/${ep.id}`, { headers: { cookie } })).json()) as { session: { id: string } };
    let understandInput = '';
    setFakeResponder((m) => {
      if (textOf(m[0]!.content).startsWith('STAGE: understand')) understandInput = textOf(m[1]!.content);
      return fakeResponder(m);
    });
    const res = await app.request('/api/generations', { method: 'POST', headers, body: JSON.stringify({ topic: '', coachingSessionId: session.id, customization: { lengthMinutes: 1, episodes: 1, speakerFormat: 'single', learningMode: 'explore' } }) });
    expect(res.status).toBe(202);
    await runNextJob(ctx!.worker!);
    expect(understandInput).toContain('How would this work for hiring decisions?');
    expect(understandInput).toContain(ep.title);
  });

  it("refuses to build a podcast from someone else's coaching", async () => {
    const { app, headers, cookie, ep } = await withEpisode();
    await app.request(`/api/coach/${ep.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'Mine' }) });
    const { session } = (await (await app.request(`/api/coach/${ep.id}`, { headers: { cookie } })).json()) as { session: { id: string } };
    const other = await signUpVerified(app, ctx!, { email: 'thief@example.com' });
    const res = await app.request('/api/generations', { method: 'POST', headers: { ...headers, cookie: other }, body: JSON.stringify({ topic: '', coachingSessionId: session.id }) });
    expect(res.status).toBe(400);
  });
});
