import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LlmError, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { reindexPublicSeries, runNextJob } from './index';
import { claimNextJob } from './queue';
import { fakeResponder, setFakeValidation } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
const PASS = () => ({ scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5 }, passed: true, problems: [], sectionsToRevise: [], revisionNotes: '' });
afterEach(async () => {
  setFakeValidation(PASS);
  await world?.handle.close();
  world = undefined;
});

describe('review fixes', () => {
  it('a public series whose search indexing fails is still ready', async () => {
    world = await makeWorld();
    world.deps.embedder = { name: 'broken', embed: async () => { throw new Error('embedding service down'); } };
    const job = await world.enqueue('Public one', { episodes: 1, visibility: 'public' });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    const [s] = await world.db.select().from(schema.podcastSeries);
    expect(s!.status).toBe('ready');
  });

  it('re-indexes public series the API could not index, and those made by an older embedder', async () => {
    world = await makeWorld();
    world.deps.embedder = { name: 'broken', embed: async () => { throw new Error('down'); } };
    await world.enqueue('Public one', { episodes: 1, visibility: 'public' });
    await runNextJob(world.deps);
    const vec = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    world.deps.embedder = { name: 'new-model@512', embed: async (t) => t.map(() => vec) };
    expect(await reindexPublicSeries(world.deps)).toBe(1);
    const [s] = await world.db.select().from(schema.podcastSeries);
    expect(s!.embeddingModel).toBe('new-model@512');
    expect(await reindexPublicSeries(world.deps)).toBe(0); // up to date
    world.deps.embedder = { name: 'newer-model@512', embed: async (t) => t.map(() => vec) };
    expect(await reindexPublicSeries(world.deps)).toBe(1);
  });

  it('does not tell the listener a team was notified unless a notifier exists', async () => {
    setFakeValidation(() => ({ ...PASS(), scores: { ...PASS().scores, accuracy: 1 }, passed: false }));
    world = await makeWorld();
    const notes: string[] = [];
    world.deps.notifyAdmins = async (subject) => {
      notes.push(subject);
      return true;
    };
    const job = await world.enqueue('Held', { episodes: 1 });
    await runNextJob(world.deps);
    expect(notes).toHaveLength(1);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.error).toMatch(/notified/);

    const world2 = await makeWorld();
    const job2 = await world2.enqueue('Held again', { episodes: 1 });
    await runNextJob(world2.deps);
    const [j2] = await world2.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job2.id));
    expect(j2!.error).not.toMatch(/notified/);
    await world2.handle.close();
  });

  it('a human rejection sticks when the job is resumed for another episode', async () => {
    setFakeValidation(() => ({ ...PASS(), scores: { ...PASS().scores, accuracy: 1 }, passed: false }));
    world = await makeWorld();
    const job = await world.enqueue('Two held', { episodes: 2 });
    await runNextJob(world.deps);
    const eps = await world.db.select().from(schema.episode).orderBy(schema.episode.number);
    // Reject episode 1 and approve episode 2, as the admin routes do.
    await world.db.insert(schema.episodeQualityCheck).values({ episodeId: eps[0]!.id, revision: 99, passed: 0, scores: {}, notes: ['no'], checkedBy: 'human' });
    await world.db.update(schema.episode).set({ status: 'rejected' }).where(eq(schema.episode.id, eps[0]!.id));
    await world.db.insert(schema.episodeQualityCheck).values({ episodeId: eps[1]!.id, revision: 99, passed: 1, scores: {}, notes: ['ok'], checkedBy: 'human' });
    await world.db.update(schema.episode).set({ status: 'pending' }).where(eq(schema.episode.id, eps[1]!.id));
    await world.db.update(schema.generationJob).set({ status: 'queued', runAfter: new Date(0), attempts: 0 }).where(eq(schema.generationJob.id, job.id));
    setFakeValidation(PASS);
    await runNextJob(world.deps);
    const after = await world.db.select().from(schema.episode).orderBy(schema.episode.number);
    expect(after.map((e) => e.status)).toEqual(['rejected', 'ready']);
    // A rejected episode is off the series, not a failure: the rest of the series is complete.
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
  });

  it("a worker that lost its lease cannot overwrite the new owner's result", async () => {
    world = await makeWorld((m: ChatMessage[]) => fakeResponder(m));
    const job = await world.enqueue('Fenced', { episodes: 1 });
    const claimed = await claimNextJob(world.db, 'slow-worker', { leaseSeconds: 600, concurrency: 5 });
    // Another worker took over.
    await world.db.update(schema.generationJob).set({ lockedBy: 'other-worker' }).where(eq(schema.generationJob.id, job.id));
    const { runJob } = await import('./pipeline');
    const result = await runJob(claimed!, { ...world.deps, workerId: 'slow-worker' });
    expect(result).toBe('lost_lease');
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.lockedBy).toBe('other-worker');
    expect(j!.status).toBe('running');
  });
});

describe('secondsUntilNextJob', () => {
  it('reports a job that is ready, one waiting a short retry, and nothing when the queue is empty', async () => {
    const { secondsUntilNextJob } = await import('./queue');
    world = await makeWorld();
    expect(await secondsUntilNextJob(world.db, 600)).toBeNull();
    const job = await world.enqueue('Soon', { episodes: 1 });
    expect(await secondsUntilNextJob(world.db, 600)).toBe(0);
    await world.db.update(schema.generationJob).set({ runAfter: new Date(Date.now() + 120_000) }).where(eq(schema.generationJob.id, job.id));
    const wait = await secondsUntilNextJob(world.db, 600);
    expect(wait).toBeGreaterThan(100);
    expect(wait).toBeLessThanOrEqual(120);
    expect(await secondsUntilNextJob(world.db, 60)).toBeNull();
  });
});

describe('rejected AI keys', () => {
  it('fail at once with a clear message instead of retrying', async () => {
    world = await makeWorld(() => {
      throw new LlmError('groq returned 401: Invalid API Key', 401);
    });
    const job = await world.enqueue('Bad key', { episodes: 1 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('failed');
    expect(j!.attempts).toBe(1);
    expect(j!.error).toMatch(/rejected ThinkMade's access key/);
  });
});

describe('short plans', () => {
  it('asks the model to plan every requested episode instead of failing', async () => {
    let planCalls = 0;
    world = await makeWorld((messages) => {
      const out = fakeResponder(messages);
      const system = typeof messages[0]!.content === 'string' ? messages[0]!.content : '';
      if (!system.startsWith('STAGE: plan')) return out;
      planCalls++;
      if (planCalls > 1) return out;
      const plan = JSON.parse(out) as { episodes: unknown[] };
      return JSON.stringify({ ...plan, episodes: plan.episodes.slice(0, 1) }); // first reply drops episodes
    });
    const job = await world.enqueue('Two episodes', { episodes: 2 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    expect(planCalls).toBe(2);
  });

  it('plans a long series a few episodes at a time, so a model that stops early still covers them all', async () => {
    const asked: number[][] = [];
    const earlier: number[] = [];
    world = await makeWorld((messages) => {
      const out = fakeResponder(messages);
      const system = typeof messages[0]!.content === 'string' ? messages[0]!.content : '';
      if (!system.startsWith('STAGE: plan')) return out;
      const text = messages[1]!.content as string;
      const inp = JSON.parse(text.slice(text.indexOf('INPUT:') + 6)) as { episodes: { number: number }[]; earlierEpisodes?: unknown[] };
      asked.push(inp.episodes.map((e) => e.number));
      earlier.push(inp.earlierEpisodes?.length ?? 0);
      const plan = JSON.parse(out) as { episodes: unknown[] };
      return JSON.stringify({ ...plan, episodes: plan.episodes.slice(0, 3) }); // never more than 3 per reply
    });
    const job = await world.enqueue('Ten episodes', { episodes: 10, lengthMinutes: 1 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    expect(asked.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(earlier).toEqual([0, 3, 6, 9]); // each batch sees the episodes already planned
    expect(await world.db.select().from(schema.episode)).toHaveLength(10);
  });
});

describe('daily allowance used up', () => {
  it('waits until the provider says the allowance resets, instead of failing within the hour', async () => {
    world = await makeWorld(() => {
      throw new LlmError('All providers at their limits', 429, 2 * 3600_000);
    });
    const job = await world.enqueue('Late in the day', { episodes: 1 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('queued');
    const waitHours = (j!.runAfter.getTime() - Date.now()) / 3600_000;
    expect(waitHours).toBeGreaterThan(1.9);
    expect(waitHours).toBeLessThan(2.2);
  });

  it('keeps waiting through many short limits, and gives up only after a day and a half', async () => {
    const w = (world = await makeWorld(() => {
      throw new LlmError('All providers at their limits', 429);
    }));
    const job = await w.enqueue('Busy day', { episodes: 1 });
    const t = schema.generationJob;
    const run = async (sinceHoursAgo: number) => {
      await w.db.update(t).set({ runAfter: new Date(0), state: { rateLimitRetries: 20, rateLimitedSince: Date.now() - sinceHoursAgo * 3600_000 } }).where(eq(t.id, job.id));
      await runNextJob(w.deps);
      return (await w.db.select().from(t).where(eq(t.id, job.id)))[0]!;
    };
    expect((await run(10)).status).toBe('queued');
    const late = await run(37);
    expect(late.status).toBe('failed');
    expect(late.error).toMatch(/usage limit/);
  });
});
