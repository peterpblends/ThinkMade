import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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

describe('a podcast in another language', () => {
  it('is written in that language at every stage and voiced by its native voices', async () => {
    const systems = new Map<string, string>();
    const w = (world = await makeWorld((m: ChatMessage[]) => {
      const system = textOf(m.find((x) => x.role === 'system')!.content);
      systems.set(system.match(/^STAGE: (\w+)/)![1]!, system);
      return fakeResponder(m);
    }));
    const languages: Array<string | undefined> = [];
    const tts = w.deps.tts;
    w.deps.tts = { ...tts, synthesize: (text, voice, o) => (languages.push(o?.language), tts.synthesize(text, voice, o)) };
    const job = await w.enqueue('Cómo tomar mejores decisiones', { episodes: 1, speakerFormat: 'two_hosts', language: 'fr' });
    await runNextJob(w.deps);
    const [j] = await w.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status).toBe('succeeded');
    for (const stage of ['understand', 'select_models', 'plan', 'script']) expect(systems.get(stage), stage).toMatch(/This podcast is in French \(Français\)/);
    // French has one native voice, so the show has one host rather than two sharing a voice.
    const [ep] = await w.db.select().from(schema.episode);
    expect(ep!.hosts!.map((h) => h.voice)).toEqual(['ff_siwis']);
    expect(new Set(languages)).toEqual(new Set(['fr']));
  });

  it('English podcasts are unchanged', async () => {
    const systems: string[] = [];
    const w = (world = await makeWorld((m: ChatMessage[]) => (systems.push(textOf(m[0]!.content)), fakeResponder(m))));
    await w.enqueue('Better decisions', { episodes: 1 });
    await runNextJob(w.deps);
    expect(systems.some((s) => s.includes('LANGUAGE:'))).toBe(false);
  });
});
