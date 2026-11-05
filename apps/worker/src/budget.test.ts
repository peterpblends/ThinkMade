import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { episodeTokenAllowance, runNextJob, splitLongLines } from './index';
import { recoverBudgetStops } from './recover';
import { setFakeValidation } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
const PASS = { scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5 }, passed: true, problems: [], sectionsToRevise: [], revisionNotes: '' };
afterEach(async () => {
  setFakeValidation(() => PASS);
  await world?.handle.close();
  world = undefined;
});

describe('token budgets', () => {
  it('give each episode an allowance that grows with its length', () => {
    expect(episodeTokenAllowance(5)).toBeLessThan(episodeTokenAllowance(15));
    expect(episodeTokenAllowance(15)).toBeGreaterThanOrEqual(150_000);
  });

  it('never stop a series: an episode at its allowance is recorded when its script passes the automatic checks', async () => {
    // The first review (episode 1, which has already spent its allowance) is unhappy; later ones pass.
    let reviews = 0;
    setFakeValidation(() => (++reviews === 1 ? { ...PASS, scores: { ...PASS.scores, flow: 2 }, passed: false, problems: ['Flat.'], sectionsToRevise: [1], revisionNotes: 'Livelier.' } : PASS));
    world = await makeWorld();
    const job = await world.enqueue('Budget please', { episodes: 2, speakerFormat: 'single', maxTokens: 1 });
    await world.db.update(schema.generationJob).set({ state: { scripts: { '1': { sections: [], tokens: 10_000_000 } } } }).where(eq(schema.generationJob.id, job.id));
    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    const eps = await world.db.select().from(schema.episode).where(eq(schema.episode.seriesId, j!.seriesId!));
    expect(eps.map((e) => e.status)).toEqual(['ready', 'ready']);
    // Episode 1 was recorded after its one review, with no rewrite; episode 2 passed its review.
    expect(reviews).toBe(2);
    const ep1 = eps.find((e) => e.number === 1)!;
    const checks = await world.db.select().from(schema.episodeQualityCheck).where(eq(schema.episodeQualityCheck.episodeId, ep1.id));
    expect(checks.map((c) => c.passed)).toEqual([0]);
  });
});

describe('long lines', () => {
  it('are split at sentence ends instead of failing the section', () => {
    const long = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} of a very long turn.`).join(' ');
    const out = splitLongLines([{ speaker: 'A', text: long }, { speaker: 'B', text: 'Short.' }], 300);
    expect(out.length).toBeGreaterThan(3);
    expect(out.every((s) => s.text.length <= 300)).toBe(true);
    expect(out.slice(0, -1).every((s) => s.speaker === 'A')).toBe(true);
    expect(out.map((s) => s.text).join(' ').replace(/\s+/g, ' ')).toBe(`${long} Short.`);
  });
});

describe('recovering podcasts the old budget stopped', () => {
  it('starts them again once, keeping finished episodes and making the rest', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Stopped by budget', { episodes: 2, speakerFormat: 'single' });
    await runNextJob(world.deps);
    const t = schema.generationJob;
    const [done] = await world.db.select().from(t).where(eq(t.id, job.id));
    const eps = await world.db.select().from(schema.episode).where(eq(schema.episode.seriesId, done!.seriesId!));
    // As the old budget left it: the second episode failed, the job partial, the tokens spent.
    const second = eps.find((e) => e.number === 2)!;
    await world.db.update(schema.episode).set({ status: 'failed', audioKey: null }).where(eq(schema.episode.id, second.id));
    await world.db.update(schema.podcastSeries).set({ status: 'partial' }).where(eq(schema.podcastSeries.id, done!.seriesId!));
    await world.db
      .update(t)
      .set({ status: 'partial', error: 'This series hit its language-model budget (400000 tokens).', finishedAt: new Date(), state: { ...(done!.state as object), tokens: 400_123 } })
      .where(eq(t.id, job.id));

    expect(await recoverBudgetStops(world.db)).toBe(1);
    const [queued] = await world.db.select().from(t).where(eq(t.id, job.id));
    expect(queued).toMatchObject({ status: 'queued', error: null, attempts: 0 });
    expect((queued!.state as { tokens?: number }).tokens).toBeUndefined();
    // Only once.
    expect(await recoverBudgetStops(world.db)).toBe(0);

    await runNextJob(world.deps);
    const after = await world.db.select().from(schema.episode).where(eq(schema.episode.seriesId, done!.seriesId!));
    expect(after.map((e) => e.status).sort()).toEqual(['ready', 'ready']);
    const [series] = await world.db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, done!.seriesId!));
    expect(series!.status).toBe('ready');
  });
});
