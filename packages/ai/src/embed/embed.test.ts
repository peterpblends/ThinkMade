import { describe, expect, it } from 'vitest';
import { cosine, createEmbedder, createHashEmbedder, createOpenAiCompatibleEmbedder, EMBED_DIMS } from './embed';

describe('hash embedder', () => {
  const e = createHashEmbedder();
  it('returns unit vectors of the stored size', async () => {
    const [v] = await e.embed(['Why do projects run late?']);
    expect(v).toHaveLength(EMBED_DIMS);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
  });
  it('scores related texts above unrelated ones', async () => {
    const [q, a, b] = await e.embed([
      'why do my projects always run late and miss deadlines',
      'Theory of Constraints: finding the bottleneck that makes projects late',
      'Choosing a sourdough starter for weekend baking',
    ]);
    expect(cosine(q!, a!)).toBeGreaterThan(cosine(q!, b!) + 0.1);
  });
  it('handles empty text', async () => {
    const [v] = await e.embed(['']);
    expect(v!.every((x) => x === 0)).toBe(true);
  });
});

describe('OpenAI-compatible embedder', () => {
  it('requests 384 dimensions and normalises the result', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, (_, i) => (i < 384 ? 2 : 9)) }] }), { status: 200 });
    }) as typeof fetch;
    const emb = createOpenAiCompatibleEmbedder({ baseUrl: 'https://x/v1', model: 'm', fetch: fetchFn });
    const [v] = await emb.embed(['hello']);
    expect(body).toMatchObject({ model: 'm', input: ['hello'], dimensions: 384 });
    expect(v).toHaveLength(384);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
  });
});

describe('createEmbedder', () => {
  it('defaults to the built-in hash embedder', () => {
    expect(createEmbedder(null, {}).name).toBe('hash');
  });
});
