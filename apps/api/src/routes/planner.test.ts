import { afterEach, describe, expect, it } from 'vitest';
import { setFakeResponder, textOf } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { fakeResponder } from '@thinkmade/worker';
import { createApp } from '../app';
import { createTestContext, signUpVerified } from '../test-helpers';
import { parsePlannerSettings } from './planner';

let ctx: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => {
  setFakeResponder(fakeResponder);
  await ctx?.close();
  ctx = undefined;
});

const current = { topic: 'Deciding under pressure', episodes: 3, lengthMinutes: 15, speakerFormat: 'single', learningMode: 'explore' };

async function setup() {
  ctx = await createTestContext();
  const app = createApp(ctx);
  const cookie = await signUpVerified(app, ctx, { email: 'plan@example.com' });
  const headers = { cookie, 'content-type': 'application/json', origin: ctx.env.APP_URL };
  return { app, headers };
}

describe('planning a podcast by conversation', () => {
  it('asks a clarifying question, then writes the brief and sets the podcast up', async () => {
    const { app, headers } = await setup();
    let system = '';
    setFakeResponder((m) => {
      if (textOf(m[0]!.content).startsWith('STAGE: planner')) system = textOf(m[0]!.content);
      return fakeResponder(m);
    });
    const first = await app.request('/api/planner', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'I freeze when decisions are urgent' }], current }) });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ reply: 'Got it. What would you most like to be able to do differently once you have listened?', settings: {} });
    expect(system).toMatch(/Ask clarifying questions, one at a time/);
    expect(system).toContain('"topic":"Deciding under pressure"');

    const second = await app.request('/api/planner', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'I freeze when decisions are urgent' },
          { role: 'assistant', content: 'Got it. What would you most like to be able to do differently?' },
          { role: 'user', content: 'Decide calmly at work. Keep it short, with two hosts.' },
        ],
        current,
      }),
    });
    expect(await second.json()).toEqual({
      reply: 'Great, I have set up three short episodes with two hosts to help you decide with more confidence.',
      settings: { brief: 'I want to make better decisions under pressure at work.', episodes: 3, lengthMinutes: 10, speakerFormat: 'two_hosts', learningMode: 'deepen', ready: true },
    });
  });

  it('streams the reply without the settings line, and sends the settings at the end', async () => {
    const { app, headers } = await setup();
    setFakeResponder((m) => (textOf(m[0]!.content).startsWith('STAGE: planner') ? 'Five episodes it is.\nSETTINGS: {"episodes": 5}' : fakeResponder(m)));
    const res = await app.request('/api/planner', { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Make it five episodes' }], current }) });
    const events = (await res.text()).split('\n\n').filter(Boolean).map((b) => ({ event: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)![1]!) }));
    const streamed = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(streamed.trim()).toBe('Five episodes it is.');
    expect(streamed).not.toContain('SETTINGS');
    expect(events.at(-1)).toEqual({ event: 'done', data: { reply: 'Five episodes it is.', settings: { episodes: 5 } } });
  });

  it('keeps settings to the allowed choices and ignores anything malformed', () => {
    const allowed = { episodes: [1, 3, 5, 10], lengthMinutes: [5, 10, 15, 20, 30], languages: [{ code: 'en', name: 'English' }] };
    expect(parsePlannerSettings('Ok.\nSETTINGS: {"episodes": 4, "lengthMinutes": 25, "language": "ja"}', allowed)).toEqual({ episodes: 3, lengthMinutes: 20 });
    expect(parsePlannerSettings('Ok.\nSETTINGS: {not json', allowed)).toEqual({});
    expect(parsePlannerSettings('No settings here.', allowed)).toEqual({});
    expect(parsePlannerSettings('Ok.\nSETTINGS: {"speakerFormat": "five"}', allowed)).toEqual({});
  });

  it('is for signed-in listeners only, and follows its feature switch', async () => {
    const { app, headers } = await setup();
    expect((await app.request('/api/planner', { method: 'POST', headers: { 'content-type': 'application/json', origin: ctx!.env.APP_URL }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], current }) })).status).toBe(401);
    expect((await app.request('/api/planner', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'assistant', content: 'Hi' }], current }) })).status).toBe(400);
    const [user] = await ctx!.db.select().from(schema.user);
    await ctx!.settings.update({ features: { planner: false } }, { id: user!.id });
    expect((await app.request('/api/planner', { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], current }) })).status).toBe(403);
  });
});
