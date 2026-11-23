import { describe, expect, it } from 'vitest';
import { createGeminiImages, ImageUnavailableError } from './gemini-image';

describe('Gemini images', () => {
  it('asks for an image in the house style and returns its bytes', async () => {
    const bodies: string[] = [];
    const png = Buffer.from([137, 80, 78, 71]).toString('base64');
    const gen = createGeminiImages({ apiKey: 'k', fetch: (async (_u: string, init: RequestInit) => (bodies.push(String(init.body)), new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] })))) as unknown as typeof fetch });
    const img = await gen.generate('A kitchen where every order waits at one oven');
    expect(img.mimeType).toBe('image/png');
    expect([...img.bytes]).toEqual([137, 80, 78, 71]);
    const sent = JSON.parse(bodies[0]!) as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseModalities: string[] } };
    expect(sent.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(sent.contents[0]!.parts[0]!.text).toMatch(/one oven[\s\S]*No words, letters, numbers or logos[\s\S]*no real or identifiable people/);
  });

  it('says images are unavailable when the key has no image allowance', async () => {
    const gen = createGeminiImages({ apiKey: 'k', fetch: (async () => new Response('Quota exceeded ... free_tier_requests, limit: 0', { status: 429 })) as unknown as typeof fetch });
    await expect(gen.generate('x')).rejects.toBeInstanceOf(ImageUnavailableError);
  });
});
