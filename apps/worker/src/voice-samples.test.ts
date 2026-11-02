import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@thinkmade/db';
import { DEFAULT_APP_SETTINGS, VOICE_SAMPLE_MANIFEST_KEY, voiceInfo, voiceSampleKey } from '@thinkmade/shared';
import { runNextJob } from './index';
import { makeWorld } from './testing/fixtures';
import { ensureVoiceSamples } from './voice-samples';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

async function manifest(w: NonNullable<typeof world>): Promise<string[]> {
  const obj = await w.storage.get(VOICE_SAMPLE_MANIFEST_KEY);
  const chunks: Buffer[] = [];
  for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
  return (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { voices: string[] }).voices;
}

describe('voice samples', () => {
  it('renders a sample for each available voice once, and lists them for the API', async () => {
    const w = (world = await makeWorld());
    const voices = ['phonon:zoey', 'bm_george', 'af_heart'];
    await w.db.update(schema.appSetting).set({ document: { ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: voices } } as never }).where(eq(schema.appSetting.active, true));

    expect(await ensureVoiceSamples(w.deps)).toBe(3);
    for (const v of voices) expect((await w.storage.head(voiceSampleKey(v)))?.size).toBeGreaterThan(1000);
    expect(await manifest(w)).toEqual([...voices].sort());
    // Already done: nothing to render.
    expect(await ensureVoiceSamples(w.deps)).toBe(0);

    // A voice added later gets its sample next time.
    await w.db.update(schema.appSetting).set({ document: { ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: [...voices, 'bf_emma'] } } as never }).where(eq(schema.appSetting.active, true));
    expect(await ensureVoiceSamples(w.deps)).toBe(1);
    expect(await manifest(w)).toContain('bf_emma');
  });

  it('casts only male voices when the listener asks for them', async () => {
    const w = (world = await makeWorld());
    const job = await w.enqueue('A two-host show about focus', { episodes: 1, speakerFormat: 'two_hosts', voiceGender: 'male' });
    await runNextJob(w.deps);
    const [j] = await w.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    const [ep] = await w.db.select().from(schema.episode);
    expect(ep!.hosts!.map((h) => voiceInfo(h.voice)!.gender)).toEqual(['male', 'male']);
  });
});
