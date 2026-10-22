import type { TtsEngine } from './types';

export interface KokoroOptions {
  /** Quantisation: q8 is a good CPU default; fp32 is highest quality and slowest. */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  modelId?: string;
  /** Speaking speed multiplier (1 = natural). */
  speed?: number;
}

/**
 * Kokoro-82M (Apache-2.0) running locally on CPU through ONNX Runtime.
 * The model (~90 MB at q8) downloads from Hugging Face on first use and is cached.
 */
export function createKokoroTts(options: KokoroOptions = {}): TtsEngine {
  let modelPromise: Promise<{ generate: (t: string, o: { voice: string; speed?: number }) => Promise<{ audio: Float32Array; sampling_rate: number }> }> | null = null;
  const load = () =>
    (modelPromise ??= (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      return (await KokoroTTS.from_pretrained(options.modelId ?? 'onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: options.dtype ?? 'q8',
        device: 'cpu',
      })) as never;
    })());
  return {
    name: 'kokoro',
    sampleRate: 24_000,
    async synthesize(text, voice) {
      const model = await load();
      const out = await model.generate(text, { voice, speed: options.speed ?? 1 });
      return { samples: out.audio, sampleRate: out.sampling_rate };
    },
  };
}
