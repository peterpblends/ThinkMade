export interface SttEngine {
  readonly name: string;
  transcribe(
    audio: Buffer,
    meta: {
      filename: string;
      contentType: string;
      language?: string;
      /** Words likely to come up (names, terms), so they are spelled right. */
      prompt?: string;
      timeoutMs?: number;
    },
  ): Promise<{ text: string }>;
}
