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

  it('runs an interview with a simulated guest when that suits the topic, and gives the writer the hook and the lines before', async () => {
    const seen: Record<string, Array<Record<string, any>>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- recorded stage inputs
    world = await makeWorld((messages) => {
      const stage = textOf(messages[0]!.content).match(/^STAGE: (\w+)/)?.[1] ?? '';
      const text = textOf(messages[1]!.content);
      (seen[stage] ??= []).push(JSON.parse(text.slice(text.indexOf('INPUT:') + 6)));
      const out = fakeResponder(messages);
      if (stage === 'understand') return JSON.stringify({ ...JSON.parse(out), suggestedFormat: 'interview' });
      if (stage === 'plan') {
        const plan = JSON.parse(out) as { episodes: Array<Record<string, unknown>> };
        return JSON.stringify({ episodes: plan.episodes.map((e) => ({ ...e, hook: 'A surgeon who stopped a routine operation halfway.', throughline: 'When should you stop?' })) });
      }
      return out;
    });
    await world.enqueue('How do I know when to quit a project?', { episodes: 1, lengthMinutes: 10, speakerFormat: 'two_hosts' });
    await runNextJob(world.deps);
    const [ep] = await world.db.select().from(schema.episode);
    expect(ep!.status).toBe('ready');
    expect(ep!.hosts!.map((h) => [h.kind, h.simulated ?? false])).toEqual([['host', false], ['guest', true]]);
    expect(seen.plan![0]!.showFormat).toBe('interview');
    const [first, second] = seen.script!.filter((x) => !x.continueFrom);
    expect(first).toMatchObject({ showFormat: 'interview', episode: { hook: 'A surgeon who stopped a routine operation halfway.', throughline: 'When should you stop?' } });
    expect(first!.hosts[1]).toMatchObject({ kind: 'guest', simulated: true });
    expect(first!.previousLines).toBeUndefined();
    // The second section sees how the first one ended, word for word, with names.
    expect(second!.previousLines.length).toBeGreaterThan(0);
    expect(second!.previousLines.at(-1)).toMatch(new RegExp(`^${ep!.hosts![1]!.name}: |^${ep!.hosts![0]!.name}: `));
    expect(seen.validate![0]!.showFormat).toBe('interview');
  });

  it('keeps one interviewer for the series and brings a different guest, suited to the episode, each time', async () => {
    const guests = ['a historian of failed expeditions', 'a surgeon who studies when to stop operating', 'a venture investor who kills projects early'];
    world = await makeWorld((messages) => {
      const stage = textOf(messages[0]!.content).match(/^STAGE: (\w+)/)?.[1] ?? '';
      const out = fakeResponder(messages);
      if (stage === 'understand') return JSON.stringify({ ...JSON.parse(out), suggestedFormat: 'interview' });
      if (stage === 'plan') {
        const plan = JSON.parse(out) as { episodes: Array<{ number: number }> };
        return JSON.stringify({ episodes: plan.episodes.map((e) => ({ ...e, guest: { expertise: guests[e.number - 1], perspective: 'Sceptical of sunk-cost thinking.', gender: e.number === 2 ? 'female' : null } })) });
      }
      return out;
    });
    await world.enqueue('When should I quit a project?', { episodes: 3, lengthMinutes: 1, speakerFormat: 'two_hosts' });
    await runNextJob(world.deps);
    const eps = await world.db.select().from(schema.episode).orderBy(schema.episode.number);
    expect(eps.map((e) => e.status)).toEqual(['ready', 'ready', 'ready']);
    const interviewers = eps.map((e) => e.hosts![0]!);
    expect(new Set(interviewers.map((h) => h.voice)).size).toBe(1);
    expect(interviewers.every((h) => h.kind === 'host')).toBe(true);
    const episodeGuests = eps.map((e) => e.hosts![1]!);
    expect(new Set(episodeGuests.map((h) => h.voice)).size).toBe(3);
    expect(new Set(episodeGuests.map((h) => h.name)).size).toBe(3);
    expect(episodeGuests.every((g) => g.kind === 'guest' && g.simulated)).toBe(true);
    episodeGuests.forEach((g, i) => expect(g.role).toContain(guests[i]));
    expect(voiceInfo(episodeGuests[1]!.voice)!.gender).toBe('female');
  });
});
