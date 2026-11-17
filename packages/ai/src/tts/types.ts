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

/** One line of a conversation performed in one go: who says it (a name), in which voice. */
export interface DialogueLine {
  speaker: string;
  voice: string;
  text: string;
}

export interface TtsEngine {
  readonly name: string;
  readonly sampleRate: number;
  synthesize(text: string, voice: string, options?: SpeakOptions): Promise<SpeechAudio>;
  /**
   * Performs a stretch of conversation (at most two people) in one take, so turn-taking and reactions sound
   * like real people. Engines without it speak line by line.
   */
  synthesizeDialogue?(lines: DialogueLine[], options?: SpeakOptions): Promise<SpeechAudio>;
  /** Whether this engine (as configured) can speak with the voice. */
  handles?(voice: string): boolean;
  /** One-time readiness check (e.g. that a cloud voice service works with this key). */
  prepare?(): Promise<void>;
}
