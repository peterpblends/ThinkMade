import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { runNextJob } from './index';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

describe('maximum length', () => {
  it('builds a 60-minute episode in sections and measures it honestly', async () => {
    world = await makeWorld();
    const job = await world.enqueue('A long one', { episodes: 1, lengthMinutes: 60, speakerFormat: 'single', bitrateKbps: 32 });
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status, j!.error ?? '').toBe('succeeded');
    const [ep] = await world.db.select().from(schema.episode);
    // 15 sections of about 600 words each, written separately (no single huge completion).
    const sections = await world.db.select().from(schema.generationStage).where(eq(schema.generationStage.stage, 'script'));
    expect(sections.length).toBeGreaterThanOrEqual(15);
    // The tone voice speaks at about 150 words a minute, so ~60 minutes; reported from the real file.
    expect(ep!.durationSeconds!).toBeGreaterThan(55 * 60);
    expect(ep!.durationSeconds!).toBeLessThan(80 * 60);
  }, 600_000);
});
