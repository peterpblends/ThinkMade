import { afterEach, describe, expect, it } from 'vitest';
import { textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { runNextJob } from './index';
import { fakeResponder } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

type Seen = Record<string, Array<Record<string, any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- recorded stage inputs

/** The fake model, with what the understand stage says about the show, recording what each stage was given. */
function responder(seen: Seen, understanding: Record<string, unknown>, plan?: (e: Record<string, unknown>) => Record<string, unknown>) {
  return (messages: ChatMessage[]) => {
    const stage = textOf(messages[0]!.content).match(/^STAGE: (\w+)/)?.[1] ?? '';
    const text = textOf(messages[1]!.content);
    (seen[stage] ??= []).push(JSON.parse(text.slice(text.indexOf('INPUT:') + 6)));
    const out = fakeResponder(messages);
    if (stage === 'understand') return JSON.stringify({ ...JSON.parse(out), ...understanding });
    if (stage === 'plan' && plan) return JSON.stringify({ episodes: (JSON.parse(out) as { episodes: Array<Record<string, unknown>> }).episodes.map(plan) });
    return out;
  };
}

const episodes = async () => (await world!.db.select().from(schema.episode).orderBy(schema.episode.number)).filter((e) => e.status === 'ready');

describe('each podcast has its own mission and approach', () => {
  it('a podcast of founder conversations: one host, a different founder every episode', async () => {
    const seen: Seen = {};
    const mission = 'To show new founders how the classic ideas on focus play out when you are building something real.';
    world = await makeWorld(responder(seen, { mission, requestedApproach: 'founder_guests', suitableApproaches: ['founder_guests', 'co_hosts'] }));
    await world.enqueue('Interview founders about staying focused while building a startup', { episodes: 2, lengthMinutes: 1 });
    await runNextJob(world.deps);
    const eps = await episodes();
    expect(eps).toHaveLength(2);
    const host = eps[0]!.hosts![0]!;
    for (const ep of eps) {
      expect(ep.hosts![0]).toEqual(host);
      expect(ep.hosts![1]).toMatchObject({ kind: 'guest', simulated: true, role: expect.stringContaining('simulated founder') });
    }
    expect(eps[0]!.hosts![1]!.name).not.toBe(eps[1]!.hosts![1]!.name);
    expect(seen.plan![0]).toMatchObject({ showFormat: 'interview', rotatingGuests: true, guestsAreFounders: true, show: { mission, approach: expect.stringContaining('founder') } });
    expect(seen.script![0]).toMatchObject({ show: { mission } });
  });

  it('co-hosts who bring in a visitor now and then: the visitor joins only some episodes', async () => {
    const seen: Seen = {};
    world = await makeWorld(
      responder(seen, { requestedApproach: 'co_hosts_with_visitors' }, (e) => ({ ...e, guest: e.number === 3 ? { expertise: 'a negotiator who studies deadlines', perspective: '' } : null })),
    );
    await world.enqueue('How do deadlines change decisions?', { episodes: 3, lengthMinutes: 1 });
    await runNextJob(world.deps);
    const eps = await episodes();
    expect(eps.map((e) => e.hosts!.length)).toEqual([2, 2, 3]);
    expect(eps[2]!.hosts![2]).toMatchObject({ kind: 'guest', simulated: true, role: expect.stringContaining('a negotiator who studies deadlines') });
    // The co-hosts are the same people, with the same voices, in every episode.
    expect(eps[2]!.hosts!.slice(0, 2)).toEqual(eps[0]!.hosts);
    expect(seen.plan![0]).toMatchObject({ visitingGuests: true, showFormat: 'conversation' });
  });

  it("a listener's next podcast is made differently from their last", async () => {
    const seen: Seen = {};
    world = await makeWorld(responder(seen, { suitableApproaches: ['co_hosts', 'expert_guests'] }));
    await world.enqueue('Why do teams miss deadlines?', { episodes: 1, lengthMinutes: 1 });
    await runNextJob(world.deps);
    await world.enqueue('How do I decide which projects to drop?', { episodes: 1, lengthMinutes: 1 });
    await runNextJob(world.deps);
    const [first, second] = await world.db.select().from(schema.generationJob).orderBy(schema.generationJob.createdAt);
    expect((first!.state as { approach?: string }).approach).toBe('co_hosts');
    expect((second!.state as { approach?: string }).approach).toBe('expert_guests');
  });
});
