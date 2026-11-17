import { describe, expect, it } from 'vitest';
import { createGeminiTts, TtsRateLimitedError } from './gemini';

const pcm = (n: number) => Buffer.from(new Int16Array(n).fill(1000).buffer).toString('base64');
const ok = (n = 2400) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm(n) } }] } }] }), { status: 200 });

describe('Gemini speech', () => {
  it('performs a two-person conversation in one request, with each speaker in their voice', async () => {
    const bodies: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- request bodies
    const tts = createGeminiTts({ apiKey: 'k', fetch: (async (_url: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), ok())) as typeof fetch });
    const audio = await tts.synthesizeDialogue([
      { speaker: 'Sophie', voice: 'gemini:Sulafat', text: 'So Kodak built it first.' },
      { speaker: 'Charles', voice: 'gemini:Charon', text: 'Wait, really? [laughs]' },
    ]);
    expect(audio.sampleRate).toBe(24000);
    expect(audio.samples.length).toBe(2400);
    const body = bodies[0]!;
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs).toEqual([
      { speaker: 'Sophie', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } },
      { speaker: 'Charles', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
    ]);
    const text = body.contents[0].parts[0].text as string;
    expect(text).toContain('Sophie: So Kodak built it first.');
    expect(text).toContain('Charles: Wait, really? [laughs]');
    expect(text).toMatch(/real, relaxed podcast conversation/);
    expect(text).not.toMatch(/\bAI\b|artificial|synthetic/i);
  });

  it('waits out a short rate limit, and reports a long one so the step is tried again later', async () => {
    const waits: number[] = [];
    let calls = 0;
    const busy = () => new Response('{"error":{"details":[{"retryDelay":"20s"}]}}', { status: 429 });
    const tts = createGeminiTts({ apiKey: 'k', sleep: async (ms) => void waits.push(ms), maxWaitMs: 30_000, fetch: (async () => (++calls === 1 ? busy() : ok())) as unknown as typeof fetch });
    await tts.synthesize('Hello.', 'gemini:Kore');
    expect(waits).toEqual([20_000]);
    const always = createGeminiTts({ apiKey: 'k', sleep: async () => {}, maxWaitMs: 30_000, fetch: (async () => busy()) as unknown as typeof fetch });
    await expect(always.synthesize('Hello.', 'gemini:Kore')).rejects.toBeInstanceOf(TtsRateLimitedError);
  });

  it('moves on to the next model when the key cannot use one', async () => {
    const urls: string[] = [];
    const tts = createGeminiTts({ apiKey: 'k', fetch: (async (url: string) => (urls.push(url), urls.length === 1 ? new Response('not found', { status: 404 }) : ok())) as unknown as typeof fetch });
    await tts.synthesize('Hello.', 'gemini:Kore');
    expect(urls[0]).toContain('gemini-3.1-flash-tts-preview');
    expect(urls[1]).toContain('gemini-2.5-flash-preview-tts');
    expect(tts.handles!('gemini:Kore')).toBe(true);
    expect(tts.handles!('af_heart')).toBe(false);
  });
});
