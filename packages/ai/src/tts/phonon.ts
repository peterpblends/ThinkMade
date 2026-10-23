import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { phononVoice } from '@thinkmade/shared';
import type { TtsEngine } from './types';

/** Hugging Face commits the files are pinned to, so a cached file never mixes with a newer upload. */
const MODEL_REPO = 'gradium/phonon-31m-en@92741c5b07d085ff840e26fea8ce43110b87852f';
const VOICE_REPO = 'gradium/phonon-voices@0ee17205f254b5abc43b266c8a0f215565c352f7';

export interface PhononOptions {
  /** Where model and voice files are kept between runs. */
  cacheDir?: string;
  /** Sampling temperature; 0.3 is the runtime's default. */
  temperature?: number;
  fetch?: typeof fetch;
}

interface PhononModel {
  add_voice(bytes: Uint8Array): number;
  start_generation(voice: number, text: string, temperature: number, seed: bigint): number;
  next_chunk(): number | undefined;
  generation_step(): Promise<Float32Array | undefined>;
  stop_generation(): void;
  sample_rate(): number;
}

function hubUrl(repo: string, file: string) {
  const [name, rev] = repo.split('@');
  return `https://huggingface.co/${name}/resolve/${rev}/${file}`;
}

/**
 * Phonon-31M (Apache-2.0) on CPU through its WebAssembly build. Voices are `phonon:<key>` from
 * PHONON_VOICES. Model (65 MB at q8) and voices download from Hugging Face on first use.
 */
export function createPhononTts(options: PhononOptions = {}): TtsEngine {
  const cacheDir = options.cacheDir ?? join('.data', 'models', 'phonon');
  const doFetch = options.fetch ?? fetch;

  const cached = async (repo: string, file: string): Promise<Uint8Array> => {
    const path = join(cacheDir, repo.replace(/[@/]/g, '_'), file);
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      const res = await doFetch(hubUrl(repo, file));
      if (!res.ok) throw new Error(`Phonon download of ${file} failed with ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.part`, bytes);
      await rename(`${path}.part`, path);
      return bytes;
    }
  };

  let modelPromise: Promise<PhononModel> | null = null;
  const load = () =>
    (modelPromise ??= (async () => {
      const require = createRequire(import.meta.url);
      const wasm = (await import('phonon-tts/raw')) as unknown as {
        default: (init: { module_or_path: Uint8Array }) => Promise<unknown>;
        Model: { load: (...args: unknown[]) => Promise<PhononModel> };
      };
      await wasm.default({ module_or_path: await readFile(require.resolve('phonon-tts/wasm/phonon_tts_simd_bg.wasm')) });
      const [weights, tokenizer, config] = await Promise.all(
        ['model.q8.gguf', 'tokenizer.json', 'config.json'].map((f) => cached(MODEL_REPO, f)),
      );
      return wasm.Model.load(weights, tokenizer, config, 'q8', 'en', null, null, 'cpu');
    })().catch((err) => {
      modelPromise = null; // let a later call retry
      throw err;
    }));

  const voices = new Map<string, Promise<number>>();
  const voiceIndex = (model: PhononModel, voice: string) => {
    let entry = voices.get(voice);
    if (!entry) {
      const v = phononVoice(voice);
      if (!v) return Promise.reject(new Error(`Unknown Phonon voice "${voice}".`));
      entry = cached(VOICE_REPO, `voices/${v.id}.safetensors`).then((bytes) => model.add_voice(bytes));
      entry.catch(() => voices.delete(voice));
      voices.set(voice, entry);
    }
    return entry;
  };

  // The model holds one generation at a time, so requests queue.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    name: 'phonon',
    sampleRate: 24_000,
    synthesize: (text, voice) =>
      run(async () => {
        const model = await load();
        const index = await voiceIndex(model, voice);
        model.start_generation(index, text, options.temperature ?? 0.3, 4242424242424242n);
        const parts: Float32Array[] = [];
        try {
          while (model.next_chunk() !== undefined) {
            for (let pcm = await model.generation_step(); pcm; pcm = await model.generation_step()) parts.push(pcm);
          }
        } finally {
          model.stop_generation();
        }
        const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const p of parts) {
          samples.set(p, offset);
          offset += p.length;
        }
        return { samples, sampleRate: model.sample_rate() };
      }),
  };
}

/** Kokoro voice used when a Phonon voice can't be spoken, matched on accent and gender. */
export function kokoroFallbackVoice(voice: string): string {
  const v = phononVoice(voice);
  if (!v) return voice;
  if (v.accent === 'UK') return v.gender === 'female' ? 'bf_emma' : 'bm_george';
  return v.gender === 'female' ? 'af_heart' : 'am_michael';
}

/**
 * Sends `phonon:` voices to Phonon (when given) and everything else to Kokoro. If Phonon fails, the episode is
 * finished with the closest Kokoro voice rather than failing, and the switch is logged.
 */
export function createVoiceRouterTts(engines: { phonon?: TtsEngine | undefined; kokoro: TtsEngine }, log: (message: string) => void = console.warn): TtsEngine {
  let phononBroken = false;
  return {
    name: 'phonon+kokoro',
    sampleRate: 24_000,
    async synthesize(text, voice) {
      if (!phononVoice(voice)) return engines.kokoro.synthesize(text, voice);
      if (engines.phonon && !phononBroken) {
        try {
          return await engines.phonon.synthesize(text, voice);
        } catch (err) {
          phononBroken = true;
          log(`Phonon failed, using Kokoro instead: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return engines.kokoro.synthesize(text, kokoroFallbackVoice(voice));
    },
  };
}
