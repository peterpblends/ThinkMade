export interface SpeechAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Per-line delivery hints. Engines use what they support and ignore the rest. */
export interface SpeakOptions {
  /** Changes how a line is delivered without changing the voice (a sampling seed). Same value, same take. */
  variation?: number;
  /** Speaking speed multiplier (1 = natural). */
  speed?: number;
  /** How freely the voice varies its delivery, 0 (flat) to 1 (very expressive). */
  expressiveness?: number;
  /** The language of the text (a LANGUAGES code); English when left out. */
  language?: string;
}

export interface TtsEngine {
  readonly name: string;
  readonly sampleRate: number;
  synthesize(text: string, voice: string, options?: SpeakOptions): Promise<SpeechAudio>;
}
