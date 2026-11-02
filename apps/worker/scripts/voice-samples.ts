/**
 * Renders the short spoken sample for every voice listeners may pick that doesn't have one yet, and
 * uploads them to storage (see the Voice samples workflow). Requires DATABASE_URL and the storage settings.
 *   npm run voice-samples -w apps/worker
 * With VOICE_SAMPLES_CHECK=1 (and a speech-to-text key), it also transcribes each sample and reports how much
 * of the sentence came through, as a check that every voice speaks clear English.
 */
import { createDb, getActiveAppSettings } from '@thinkmade/db';
import { voiceInfo, voiceSampleKey, voiceSampleText } from '@thinkmade/shared';
import { createWorkerDeps, ensureVoiceSamples } from '../src/index';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
const deps = await createWorkerDeps(handle.db, process.env, { log: (m, x) => console.warn(m, JSON.stringify(x ?? {})) });
const made = await ensureVoiceSamples(deps, 60 * 60_000);
console.info(`${made} voice sample(s) rendered`);

if (process.env.VOICE_SAMPLES_CHECK === '1') {
  if (!deps.stt) {
    console.warn('No speech-to-text service is configured; skipping the clarity check.');
  } else {
    const words = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? [];
    const settings = await getActiveAppSettings(handle.db);
    console.info('\nClarity: share of the sample sentence a transcriber heard (voice, heritage, %, what it heard)');
    for (const id of settings.voices.available) {
      const v = voiceInfo(id);
      if (!v) continue;
      try {
        const obj = await deps.storage.get(voiceSampleKey(id));
        const chunks: Buffer[] = [];
        for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
        const { text } = await deps.stt.transcribe(Buffer.concat(chunks), { filename: 'sample.mp3', contentType: 'audio/mpeg', language: 'en' });
        const expected = words(voiceSampleText(v.name).replace(v.name, ''));
        const heard = new Set(words(text));
        const pct = Math.round((100 * expected.filter((w) => heard.has(w)).length) / expected.length);
        console.info(`${id.padEnd(16)} ${(v.heritage ?? '-').padEnd(12)} ${String(pct).padStart(3)}%  ${text.trim()}`);
      } catch (err) {
        console.info(`${id.padEnd(16)} ${(v.heritage ?? '-').padEnd(12)}   ?  ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, 3100)); // stay inside the free transcription rate limit
    }
  }
}
await handle.close();
process.exit(0);
