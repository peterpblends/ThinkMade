export interface SpeechAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface TtsEngine {
  readonly name: string;
  readonly sampleRate: number;
  synthesize(text: string, voice: string): Promise<SpeechAudio>;
}
