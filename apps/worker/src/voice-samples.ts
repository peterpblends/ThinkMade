import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { assembleEpisode } from '@thinkmade/ai';
import { getActiveAppSettings } from '@thinkmade/db';
import { VOICE_SAMPLE_MANIFEST_KEY, voiceInfo, voiceSampleEntry, voiceSampleKey, voiceSampleText } from '@thinkmade/shared';
import type { WorkerDeps } from './deps';

async function readManifest(deps: Pick<WorkerDeps, 'storage'>): Promise<string[]> {
  try {
    const obj = await deps.storage.get(VOICE_SAMPLE_MANIFEST_KEY);
    const chunks: Buffer[] = [];
    for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { voices?: unknown };
    return Array.isArray(parsed.voices) ? parsed.voices.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Renders a short spoken sample for every voice listeners may pick that doesn't have one yet, so they can
 * hear a voice before choosing it. The manifest lists the voices with a sample (the API reads it). Stops
 * after `budgetMs` and carries on next time.
 */
export async function ensureVoiceSamples(deps: Pick<WorkerDeps, 'db' | 'tts' | 'storage' | 'workDir' | 'log'>, budgetMs = 15 * 60_000): Promise<number> {
  const started = Date.now();
  const settings = await getActiveAppSettings(deps.db);
  const done = new Set(await readManifest(deps));
  // A sample in every language each voice speaks.
  const missing = settings.voices.available.flatMap((voice) => (voiceInfo(voice)?.speaks ?? []).map((language) => ({ voice, language }))).filter((s) => !done.has(voiceSampleEntry(s.voice, s.language)));
  if (!missing.length) return 0;
  const dir = join(deps.workDir, 'voice-samples');
  mkdirSync(dir, { recursive: true });
  let made = 0;
  try {
    for (const { voice, language } of missing) {
      if (Date.now() - started > budgetMs) break;
      const out = join(dir, `${language}-${voiceSampleKey(voice).split('/').pop()}`);
      try {
        await assembleEpisode({ turns: [{ voice, text: voiceSampleText(voiceInfo(voice)!.name, language) }], tts: deps.tts, outFile: out, workDir: dir, bitrateKbps: 64, language });
        await deps.storage.putFile(voiceSampleKey(voice, language), out, 'audio/mpeg');
        done.add(voiceSampleEntry(voice, language));
        made++;
      } catch (err) {
        deps.log?.('voice sample failed', { voice, language, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    if (made) await deps.storage.put(VOICE_SAMPLE_MANIFEST_KEY, Buffer.from(JSON.stringify({ voices: [...done].sort() })), 'application/json');
    rmSync(dir, { recursive: true, force: true });
  }
  return made;
}
