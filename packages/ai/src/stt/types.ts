export interface SttEngine {
  readonly name: string;
  transcribe(audio: Buffer, meta: { filename: string; contentType: string; language?: string }): Promise<{ text: string }>;
}
