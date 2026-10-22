import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleStt } from './openai-compatible';

describe('createOpenAiCompatibleStt', () => {
  it('uploads audio as multipart and returns the text', async () => {
    let form: FormData | undefined;
    let url = '';
    const fetchFn = (async (u: string, init: RequestInit) => {
      url = u;
      form = init.body as FormData;
      return new Response(JSON.stringify({ text: ' Hello world ' }), { status: 200 });
    }) as typeof fetch;
    const stt = createOpenAiCompatibleStt({ baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'whisper-large-v3-turbo', fetch: fetchFn });
    const res = await stt.transcribe(Buffer.from('abc'), { filename: 'clip.webm', contentType: 'audio/webm' });
    expect(res.text).toBe('Hello world');
    expect(url).toBe('https://api.example/v1/audio/transcriptions');
    expect(form!.get('model')).toBe('whisper-large-v3-turbo');
    expect((form!.get('file') as File).name).toBe('clip.webm');
  });
});
