import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createToneTts, TtsRateLimitedError, type TtsEngine } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { soundAlike, voiceInfo } from '@thinkmade/shared';
import { runNextJob } from './index';
import { releaseVoiceWaits } from './recover';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

/** Gemini voices that have used up the day's allowance; every other voice is the test tone. */
function exhaustedGemini(): TtsEngine & { geminiCalls: number } {
  const tone = createToneTts();
  const engine = {
    name: 'gemini+tone',
    sampleRate: tone.sampleRate,
    geminiCalls: 0,
    handles: () => true,
    synthesize: async (text: string, voice: string, o?: Parameters<TtsEngine['synthesize']>[2]) => {
      if (voice.startsWith('gemini:')) throw new TtsRateLimitedError('Gemini speech is rate limited (429); try again in 20000s.', 20_000_000);
      return tone.synthesize(text, voice, o);
    },
    synthesizeDialogue: async () => {
      engine.geminiCalls++;
      throw new TtsRateLimitedError('Gemini speech is rate limited (429); try again in 20000s.', 20_000_000);
    },
  };
  return engine;
}

describe('when the natural voices run out for the day', () => {
  it("finishes the podcast with matched stand-in voices instead of waiting, and keeps them for every episode", async () => {
    world = await makeWorld();
    const tts = exhaustedGemini();
    world.deps.tts = tts;
    const job = await world.enqueue('Why do teams miss deadlines?', { episodes: 2, speakerFormat: 'two_hosts' });
    expect(await runNextJob(world.deps)).toBe(true);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    const state = j!.state as { hosts: Array<{ voice: string }>; voiceFallback: Record<string, string> };
    // Cast with Gemini voices; recorded with stand-ins of the same gender that don't sound alike.
    expect(state.hosts.every((h) => h.voice.startsWith('gemini:'))).toBe(true);
    const standIns = state.hosts.map((h) => state.voiceFallback[h.voice]!);
    standIns.forEach((v, i) => expect(voiceInfo(v)!.gender).toBe(voiceInfo(state.hosts[i]!.voice)!.gender));
    expect(new Set(standIns).size).toBe(2);
    expect(soundAlike(standIns[0]!, standIns[1]!)).toBe(false);
    const eps = await world.db.select().from(schema.episode).orderBy(schema.episode.number);
    expect(eps.map((e) => e.status)).toEqual(['ready', 'ready']);
    for (const e of eps) expect(e.hosts!.map((h) => h.voice).sort()).toEqual([...standIns].sort());
    // Gemini was tried once; after that the podcast kept its stand-ins.
    expect(tts.geminiCalls).toBe(1);
  }, 120_000);

  it('releases podcasts left waiting for the voice allowance', async () => {
    world = await makeWorld();
    const job = await world.enqueue('Waiting podcast');
    await world.db.update(schema.generationJob).set({ status: 'queued', runAfter: new Date(Date.now() + 6 * 3600_000), error: 'Gemini speech is rate limited (429); try again in 20682s.' }).where(eq(schema.generationJob.id, job.id));
    const other = await world.enqueue('Waiting on something else');
    await world.db.update(schema.generationJob).set({ runAfter: new Date(Date.now() + 3600_000), error: 'Rate limited by Groq' }).where(eq(schema.generationJob.id, other.id));
    expect(await releaseVoiceWaits(world.db)).toBe(1);
    const [a] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(a!.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
    const [b] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, other.id));
    expect(b!.runAfter.getTime()).toBeGreaterThan(Date.now());
  });
});
