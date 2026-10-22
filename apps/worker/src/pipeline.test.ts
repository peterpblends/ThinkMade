import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import type { ChatMessage } from '@thinkmade/ai';
import { runNextJob } from './index';
import { claimNextJob } from './queue';
import { fakeResponder } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

async function jobRow(id: string) {
  const [j] = await world!.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, id));
  return j!;
}

describe('generation pipeline', () => {
  it('turns a topic into a ready series of real, measured MP3 episodes', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Why do projects in my team always run late?');
    expect(await runNextJob(world.deps)).toBe(true);

    const j = await jobRow(job.id);
    expect(j.status).toBe('succeeded');
    expect(j.error).toBeNull();
    const [series] = await world.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, j.seriesId!));
    expect(series).toMatchObject({ status: 'ready', title: 'Thinking It Through', visibility: 'private', userId: 'u1' });

    const episodes = await world.db.select().from(schema.episode).where(eq(schema.episode.seriesId, series!.id));
    expect(episodes).toHaveLength(2);
    for (const ep of episodes) {
      expect(ep.status).toBe('ready');
      expect(ep.audioKey).toMatch(/^audio\/.+\.mp3$/);
      const head = await world.storage.head(ep.audioKey!);
      expect(head?.size).toBeGreaterThan(1000);
      // ~150 words at 0.4 s/word from the tone voice, measured from the real file.
      expect(ep.durationSeconds!).toBeGreaterThan(40);
      expect(ep.primaryMentalModelId).not.toBeNull();
      expect(ep.outcomes).toMatchObject({ thinking: expect.any(String), seeing: expect.any(String), doing: expect.any(String) });
      expect(ep.transcript!.length).toBeGreaterThan(100);
    }
    // Mixed format: episode 1 is a conversation, episode 2 a single host.
    const byNum = Object.fromEntries(episodes.map((e) => [e.number, e]));
    expect(byNum[1]!.speakerFormat).toBe('two_hosts');
    expect(byNum[1]!.transcript).toMatch(/^Maya: /);
    expect(byNum[2]!.speakerFormat).toBe('single');

    const stages = await world.db.select().from(schema.generationStage).where(eq(schema.generationStage.jobId, job.id));
    const names = new Set(stages.map((s) => s.stage));
    for (const s of ['understand', 'select_models', 'research', 'plan', 'script', 'validate', 'synthesize', 'publish']) expect(names).toContain(s);
    expect(stages.every((s) => s.status === 'done')).toBe(true);

    const library = await world.db.select().from(schema.libraryItem);
    expect(library).toEqual([expect.objectContaining({ userId: 'u1', seriesId: series!.id })]);
  });

  it('keeps only verified books as sources', async () => {
    world = await makeWorld();
    await world.enqueue('How do I make better decisions?');
    await runNextJob(world.deps);
    const sources = await world.db.select().from(schema.source);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.verificationStatus === 'verified')).toBe(true);
    expect(sources.some((s) => /invented/i.test(s.title))).toBe(false);
  });

  it('explore mode does not repeat models the user already covered', async () => {
    world = await makeWorld();
    await world.enqueue('First topic', { episodes: 2 });
    await runNextJob(world.deps);
    const firstPrimaries = (await world.db.select({ id: schema.episode.primaryMentalModelId }).from(schema.episode)).map((r) => r.id);
    const second = await world.enqueue('Second topic', { episodes: 2 });
    await runNextJob(world.deps);
    const j = await jobRow(second.id);
    const secondPrimaries = (
      await world.db.select({ id: schema.episode.primaryMentalModelId }).from(schema.episode).where(eq(schema.episode.seriesId, j.seriesId!))
    ).map((r) => r.id);
    expect(secondPrimaries.some((id) => firstPrimaries.includes(id))).toBe(false);
  });

  it('resumes from saved state after a temporary failure instead of starting over', async () => {
    const calls: string[] = [];
    let failedOnce = false;
    world = await makeWorld((messages: ChatMessage[]) => {
      const stage = String(messages[0]!.content).match(/^STAGE: (\w+)/)![1]!;
      calls.push(stage);
      if (stage === 'script' && !failedOnce) {
        failedOnce = true;
        throw new Error('temporary outage');
      }
      return fakeResponder(messages);
    });
    const job = await world.enqueue('Resilience', { episodes: 1 });
    await runNextJob(world.deps);
    let j = await jobRow(job.id);
    expect(j.status).toBe('queued');
    expect(j.attempts).toBe(1);
    expect(j.error).toMatch(/temporary outage/);
    // Make it due now and run again.
    await world.db.update(schema.generationJob).set({ runAfter: new Date(0) }).where(eq(schema.generationJob.id, job.id));
    await runNextJob(world.deps);
    j = await jobRow(job.id);
    expect(j.status).toBe('succeeded');
    expect(calls.filter((c) => c === 'understand')).toHaveLength(1);
    expect(calls.filter((c) => c === 'plan')).toHaveLength(1);
  });

  it('stops when the user cancels', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Cancel me');
    await world.db.update(schema.generationJob).set({ cancelRequested: 1 }).where(eq(schema.generationJob.id, job.id));
    await runNextJob(world.deps);
    expect((await jobRow(job.id)).status).toBe('cancelled');
  });

  it('fails immediately with an honest message when no model provider is configured', async () => {
    world = await makeWorld();
    world.deps.llm = async () => {
      const { createLlm } = await import('@thinkmade/ai');
      return createLlm({ provider: 'groq', model: 'llama' }, {});
    };
    const job = await world.enqueue('No provider');
    await runNextJob(world.deps);
    const j = await jobRow(job.id);
    expect(j.status).toBe('failed');
    expect(j.attempts).toBe(1);
    expect(j.error).toMatch(/isn't configured yet.*GROQ_API_KEY/);
  });

  it('respects the concurrency limit when claiming', async () => {
    world = await makeWorld();
    await world.enqueue('a');
    await world.enqueue('b');
    await world.enqueue('c');
    const a = await claimNextJob(world.db, 'w1', { leaseSeconds: 60, concurrency: 2 });
    const b = await claimNextJob(world.db, 'w2', { leaseSeconds: 60, concurrency: 2 });
    const c = await claimNextJob(world.db, 'w3', { leaseSeconds: 60, concurrency: 2 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.id).not.toBe(a!.id);
    expect(c).toBeNull();
  });

  it('reclaims a job whose worker died (expired lease)', async () => {
    world = await makeWorld();
    const job = await world.enqueue('orphan');
    await claimNextJob(world.db, 'dead-worker', { leaseSeconds: 60, concurrency: 5 });
    await world.db.update(schema.generationJob).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.generationJob.id, job.id));
    const again = await claimNextJob(world.db, 'live-worker', { leaseSeconds: 60, concurrency: 5 });
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
  });
});
