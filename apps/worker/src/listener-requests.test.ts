import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { voiceInfo } from '@thinkmade/shared';
import { runNextJob } from './index';
import { fakeResponder } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

const PREFERENCES = {
  hosts: [
    { name: 'Emma', gender: 'female', age: 19, role: 'A fun, relatable Christian girl who understands teenage dating.' },
    { name: 'Grace', gender: 'female', age: 22, role: 'Shares practical wisdom from dating, relationships and heartbreak.' },
    { name: 'Sarah', gender: 'female', age: 35, role: 'A warm Christian mentor who gives biblical guidance.' },
  ],
  requests: ['For teenage girls aged 15 to 19.', 'Include relevant Bible verses.', 'Avoid sounding preachy, judgmental, or like a lecture from parents.'],
  episodes: 3,
  lengthMinutes: null,
  speakerFormat: null,
};

/** The fake model, plus what the understand stage would extract from a request that describes its hosts. */
function recordingResponder(seen: Record<string, unknown[]>) {
  return (messages: ChatMessage[]) => {
    const system = textOf(messages[0]!.content);
    const stage = system.match(/^STAGE: (\w+)/)?.[1] ?? '';
    const text = textOf(messages[1]!.content);
    (seen[stage] ??= []).push(JSON.parse(text.slice(text.indexOf('INPUT:') + 6)));
    const out = fakeResponder(messages);
    if (stage !== 'understand') return out;
    return JSON.stringify({ ...JSON.parse(out), audience: 'Christian teenage girls aged 15 to 19', preferences: PREFERENCES });
  };
}

describe("the listener's requests", () => {
  it('uses the hosts they described, in every episode, and passes their requests to every writing stage', async () => {
    const seen: Record<string, Array<Record<string, any>>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- recorded stage inputs
    world = await makeWorld(recordingResponder(seen));
    const job = await world.enqueue('A Christian podcast for teenage girls with hosts Emma, Grace and Sarah');
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');

    const episodes = await world.db.select().from(schema.episode).orderBy(schema.episode.number);
    // They asked for three episodes; the fixture's default was two.
    expect(episodes).toHaveLength(3);
    for (const ep of episodes) {
      expect(ep.speakerFormat).toBe('group');
      expect(ep.hosts!.map((h) => [h.name, h.age])).toEqual([['Emma', 19], ['Grace', 22], ['Sarah', 35]]);
      expect(new Set(ep.hosts!.map((h) => h.voice)).size).toBe(3);
      for (const h of ep.hosts!) expect(voiceInfo(h.voice)?.gender).toBe('female');
      expect(ep.transcript).toMatch(/^Emma: /m);
      expect(ep.transcript).toMatch(/^Sarah: /m);
    }

    for (const stage of ['plan', 'script', 'validate']) {
      for (const inp of seen[stage]!.filter((x) => !x.continueFrom)) {
        expect(inp.listenerRequests, stage).toEqual(PREFERENCES.requests);
        expect(inp.audience, stage).toBe('Christian teenage girls aged 15 to 19');
        expect(inp.hosts.map((h: { name: string }) => h.name), stage).toEqual(['Emma', 'Grace', 'Sarah']);
      }
    }
    expect(seen.script![0]!.hosts[2]).toMatchObject({ speaker: 'C', name: 'Sarah', age: 35, role: PREFERENCES.hosts[2]!.role });
    const [series] = await world.db.select().from(schema.podcastSeries);
    expect(series!.status).toBe('ready');
  });

  it("keeps the listener's own Customise choices over numbers in their words", async () => {
    world = await makeWorld(recordingResponder({}));
    await world.enqueue('Three hosts please', { customized: true, episodes: 1, speakerFormat: 'single' });
    await runNextJob(world.deps);
    const episodes = await world.db.select().from(schema.episode);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.speakerFormat).toBe('single');
    expect(episodes[0]!.hosts!.map((h) => h.name)).toEqual(['Emma']);
  });

  it('gives a series without named hosts voices the listener has not just heard', async () => {
    world = await makeWorld();
    await world.enqueue('First series', { episodes: 1, speakerFormat: 'two_hosts' });
    await runNextJob(world.deps);
    await world.enqueue('Second series', { episodes: 1, speakerFormat: 'two_hosts' });
    await runNextJob(world.deps);
    const episodes = await world.db.select().from(schema.episode);
    const [a, b] = episodes.map((e) => e.hosts!.map((h) => h.voice));
    expect(a).toHaveLength(2);
    expect(b!.some((v) => a!.includes(v))).toBe(false);
    // Unnamed hosts are called by their voice's name, never a fixed pair.
    for (const e of episodes) for (const h of e.hosts!) expect(h.name).toBe(voiceInfo(h.voice)!.name);
  });
});
