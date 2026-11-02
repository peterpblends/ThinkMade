/**
 * Renders the short spoken sample for every voice listeners may pick that doesn't have one yet, and
 * uploads them to storage (see the Voice samples workflow). Requires DATABASE_URL and the storage settings.
 *   npm run voice-samples -w apps/worker
 * With VOICE_SAMPLES_CHECK=1 (and a speech-to-text key), it also transcribes each sample and reports how much
 * of the sentence came through, as a check that every voice speaks clear English.
 */
import { createDb, getActiveAppSettings } from '@thinkmade/db';
import { LANGUAGES, voiceInfo, voiceSampleKey, voiceSampleText } from '@thinkmade/shared';
import { createWorkerDeps, ensureVoiceSamples } from '../src/index';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
const deps = await createWorkerDeps(handle.db, process.env, { log: (m, x) => console.warn(m, JSON.stringify(x ?? {})) });
// VOICE_SAMPLES_REDO=fr,hi renders those languages' samples again.
const redo = process.env.VOICE_SAMPLES_REDO?.split(',').filter(Boolean) ?? [];
if (process.env.VOICE_SAMPLES_PHONEMES === '1') {
  // Shows the sounds eSpeak gives Kokoro for each language's sample line, to check pronunciation.
  const { espeakPhonemes } = await import('@thinkmade/ai');
  for (const l of LANGUAGES.filter((x) => x.espeak)) console.info(`phonemes ${l.code}: ${await espeakPhonemes(voiceSampleText('Ana', l.code), l.espeak!)}`);
}
const made = await ensureVoiceSamples(deps, 60 * 60_000, redo);
console.info(`${made} voice sample(s) rendered`);

if (process.env.VOICE_SAMPLES_CHECK === '1') {
  if (!deps.stt) {
    console.warn('No speech-to-text service is configured; skipping the clarity check.');
  } else {
    const words = (s: string) => s.toLowerCase().normalize('NFC').match(/[\p{L}\p{M}']+/gu) ?? [];
    const settings = await getActiveAppSettings(handle.db);
    console.info('\nClarity: share of the sample sentence a transcriber heard (voice, heritage, %, what it heard)');
    // VOICE_SAMPLES_LANGUAGES=es,fr limits the check to some languages.
    const only = process.env.VOICE_SAMPLES_LANGUAGES?.split(',').filter(Boolean);
    for (const id of settings.voices.available) {
      const v = voiceInfo(id);
      if (!v) continue;
      for (const language of v.speaks.filter((l) => !only || only.includes(l))) {
        const label = `${id} ${language}`.padEnd(20);
        try {
          const obj = await deps.storage.get(voiceSampleKey(id, language));
          const chunks: Buffer[] = [];
          for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
          const { text } = await deps.stt.transcribe(Buffer.concat(chunks), { filename: 'sample.mp3', contentType: 'audio/mpeg', language: language.slice(0, 2) });
          const expected = words(voiceSampleText(v.name, language).replace(v.name, ''));
          const heard = new Set(words(text));
          const pct = Math.round((100 * expected.filter((w) => heard.has(w)).length) / expected.length);
          console.info(`${label} ${(v.heritage ?? '-').padEnd(12)} ${String(pct).padStart(3)}%  ${text.trim()}`);
        } catch (err) {
          console.info(`${label} ${(v.heritage ?? '-').padEnd(12)}   ?  ${err instanceof Error ? err.message : String(err)}`);
        }
        await new Promise((r) => setTimeout(r, 3100)); // stay inside the free transcription rate limit
      }
    }
  }
}
await handle.close();
process.exit(0);
