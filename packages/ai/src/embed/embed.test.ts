import { describe, expect, it } from 'vitest';
import { cosine, createEmbedder, createGemmaEmbedder, createHashEmbedder, createOpenAiCompatibleEmbedder, EMBED_DIMS, EmbedderUnavailableError } from './embed';

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
  it('requests the stored size, says whether it is a query, and normalises the result', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, (_, i) => (i < 512 ? 2 : 9)) }] }), { status: 200 });
    }) as typeof fetch;
    const emb = createOpenAiCompatibleEmbedder({ baseUrl: 'https://x/v1', model: 'm', fetch: fetchFn });
    const [v] = await emb.embed(['hello'], 'query');
    expect(body).toMatchObject({ model: 'm', input: ['hello'], dimensions: 512, input_type: 'query' });
    expect(v).toHaveLength(512);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
  });
});

describe('createEmbedder', () => {
  it('defaults to the built-in hash embedder', () => {
    expect(createEmbedder(null, {}).name).toBe('hash@512');
  });

  it('runs the local model in-process, through the worker server, or reports it unavailable on Vercel', async () => {
    const cfg = { provider: 'local', model: 'embeddinggemma-2' };
    expect(createEmbedder(cfg, {}).name).toBe('embeddinggemma-2@512');
    const remote = createEmbedder(cfg, { EMBED_SERVER_URL: 'https://embed.example/v1', EMBED_SERVER_TOKEN: 't' });
    expect(remote.name).toBe('embeddinggemma-2@512'); // same vector space as the worker
    await expect(createEmbedder(cfg, { VERCEL: '1' }).embed(['q'])).rejects.toBeInstanceOf(EmbedderUnavailableError);
  });
});

// Downloads about 210 MB; run with GEMMA_LIVE=1.
describe.runIf(process.env.GEMMA_LIVE === '1')('EmbeddingGemma 2 (live)', () => {
  it('ranks by meaning, not shared words', { timeout: 600_000 }, async () => {
    const e = createGemmaEmbedder();
    const [q] = await e.embed(['how do I stop agonising over every choice'], 'query');
    const [a, b] = await e.embed(['Satisficing: pick the first option that is good enough.', 'Compound interest grows savings over decades.']);
    expect(q).toHaveLength(512);
    expect(cosine(q!, a!)).toBeGreaterThan(cosine(q!, b!) + 0.05);
  });
});
