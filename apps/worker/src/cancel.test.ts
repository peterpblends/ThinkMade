import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLlm, type LlmClient } from '@thinkmade/ai';
import { cancelJob, schema } from '@thinkmade/db';
import { runNextJob } from './index';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

/** The test model, except that the given stage never answers on its own: only an abort ends the request. */
function hangingAt(stage: string, onStart: () => void): (s: string) => Promise<LlmClient> {
  return async (s) => {
    const real = createLlm({ provider: 'fake', model: 'fake' }, { NODE_ENV: 'test' });
    if (s !== stage) return real;
    return {
      ...real,
      chat: (_messages, options) =>
        new Promise((_, reject) => {
          onStart();
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    };
  };
}

describe('cancelling', () => {
  it('stops a job in the middle of a model request within moments, and tidies its series', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Cancel me mid-script', { episodes: 2 });
    world.deps.cancelPollMs = 50;
    world.deps.llm = hangingAt('script', () => void cancelJob(world!.db, job.id));
    const started = Date.now();
    await runNextJob(world.deps);
    // The script request never answers by itself, so finishing at all means it was interrupted.
    expect(Date.now() - started).toBeLessThan(5000);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j).toMatchObject({ status: 'cancelled', lockedBy: null });
    // Episodes that were being made are gone; the series has nothing ready.
    expect(await world.db.select().from(schema.episode)).toEqual([]);
    const [series] = await world.db.select().from(schema.podcastSeries);
    expect(series!.status).toBe('failed');
  });

  it('cancels a queued job at once, before any worker runs it', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Never mind');
    expect(await cancelJob(world.db, job.id)).toBe(true);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('cancelled');
    // No worker picks it up afterwards.
    expect(await runNextJob(world.deps)).toBe(false);
    // A finished job can't be cancelled.
    expect(await cancelJob(world.db, job.id)).toBe(false);
  });
});
