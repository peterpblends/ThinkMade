/** Newest first: a model the key can't use is skipped for the next. */
export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview'] as const;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** This key can't generate images (for example a free key, which has no image allowance). */
export class ImageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUnavailableError';
  }
}

export interface ImageGenerator {
  generate(prompt: string): Promise<{ bytes: Buffer; mimeType: string }>;
}

/** The house style for coaching pictures: warm editorial illustrations, never text, logos or real people. */
export function illustrationPrompt(prompt: string): string {
  return `Create a warm, clean editorial illustration for a learning app, wide 16:9 format: ${prompt.trim()}\nStyle: modern illustration with soft natural colours and simple shapes. No words, letters, numbers or logos anywhere in the image, and no real or identifiable people.`;
}

/** Gemini's native image generation. */
export function createGeminiImages(options: { apiKey: string; fetch?: typeof fetch; models?: readonly string[] }): ImageGenerator {
  const doFetch = options.fetch ?? fetch;
  const models = [...(options.models ?? GEMINI_IMAGE_MODELS)];
  return {
    async generate(prompt) {
      let lastError = 'no image model is available to this key';
      for (const model of models) {
        const res = await doFetch(`${BASE}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: illustrationPrompt(prompt) }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
        });
        const body = await res.text();
        if (res.status === 404 || res.status === 400 || res.status === 403 || (res.status === 429 && /limit: 0|free_tier/i.test(body))) {
          // This model isn't open to this key (a free key's image allowance is zero): try the next.
          lastError = `${model}: ${res.status}`;
          continue;
        }
        if (!res.ok) throw new Error(`Gemini image failed (${res.status}): ${body.slice(0, 200)}`);
        const json = JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
        const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part) throw new Error('Gemini returned no image (it may have declined the request).');
        return { bytes: Buffer.from(part.inlineData!.data!, 'base64'), mimeType: part.inlineData!.mimeType ?? 'image/png' };
      }
      throw new ImageUnavailableError(`Images aren't available with this key (${lastError}).`);
    },
  };
}
