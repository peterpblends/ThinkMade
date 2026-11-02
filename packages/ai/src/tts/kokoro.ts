import { KOKORO_VOICE_INFO } from '@thinkmade/shared';
import type { TtsEngine } from './types';

const ENGLISH_VOICES = new Set<string>([...KOKORO_VOICE_INFO.map((v) => v.id), 'am_santa']);

type KokoroModel = {
  generate: (t: string, o: { voice: string; speed?: number }) => Promise<{ audio: Float32Array; sampling_rate: number }>;
  _validate_voice: (voice: string) => string;
};

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
  let modelPromise: Promise<KokoroModel> | null = null;
  const load = () =>
    (modelPromise ??= (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const model = (await KokoroTTS.from_pretrained(options.modelId ?? 'onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: options.dtype ?? 'q8',
        device: 'cpu',
      })) as unknown as KokoroModel;
      // kokoro-js only accepts its English voices. Its other voices (Hindi, Japanese, Mandarin, Spanish…) ship
      // with it too and speak English text with their own accent once the text is read as American English
      // ('a'); the voice's style vector still comes from that voice's file.
      const validate = model._validate_voice.bind(model);
      model._validate_voice = (voice) => (ENGLISH_VOICES.has(voice) ? validate(voice) : 'a');
      return model;
    })());
  return {
    name: 'kokoro',
    sampleRate: 24_000,
    async synthesize(text, voice, speak) {
      const model = await load();
      const out = await model.generate(text, { voice, speed: (options.speed ?? 1) * (speak?.speed ?? 1) });
      return { samples: out.audio, sampleRate: out.sampling_rate };
    },
  };
}
