export const EMBED_DIMS = 384;

export interface Embedder {
  readonly name: string;
  /** Unit-length vectors of EMBED_DIMS numbers, one per input. */
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * (b[i] ?? 0);
  return dot;
}

function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
}

const STOP = new Set('a an and are as at be but by for from has have how i in is it its my of on or so that the their them they this to was what when where which who why will with you your do does did can could should would me we our us about into than then there these those also just very'.split(' '));

function stem(w: string): string {
  return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/, (m) => (m === 'ies' ? 'y' : '')).slice(0, 12);
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Free, dependency-free keyword embedder (feature hashing of stemmed words and word pairs).
 * It captures shared vocabulary, not meaning; configure a semantic model for true semantic search.
 */
export function createHashEmbedder(): Embedder {
  return {
    name: 'hash',
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(EMBED_DIMS).fill(0);
        const words = (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
        const feats = [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)];
        const counts = new Map<string, number>();
        for (const f of feats) counts.set(f, (counts.get(f) ?? 0) + 1);
        for (const [f, c] of counts) {
          const h = fnv(f);
          v[h % EMBED_DIMS]! += ((h >>> 16) & 1 ? 1 : -1) * (1 + Math.log(c)) * (f.includes('_') ? 0.5 : 1);
        }
        return normalise(v);
      });
    },
  };
}

/** Any OpenAI-compatible /embeddings endpoint (Gemini, Ollama, OpenRouter...). Truncates Matryoshka vectors to EMBED_DIMS. */
export function createOpenAiCompatibleEmbedder(cfg: { baseUrl: string; apiKey?: string | undefined; model: string; fetch?: typeof fetch }): Embedder {
  const doFetch = cfg.fetch ?? fetch;
  return {
    name: `api:${cfg.model}`,
    async embed(texts) {
      const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, input: texts, dimensions: EMBED_DIMS }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Embedding request failed with ${res.status}`);
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map((d) => normalise(d.embedding.slice(0, EMBED_DIMS)));
    },
  };
}

const BASE: Record<string, { url: (env: Record<string, string | undefined>) => string; key?: string }> = {
  gemini: { url: () => 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY' },
  ollama: { url: (env) => env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1' },
  openrouter: { url: () => 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY' },
};

/** The configured embedder, falling back to the built-in hash embedder. */
export function createEmbedder(cfg: { provider: string; model: string } | null, env: Record<string, string | undefined>): Embedder {
  if (!cfg || cfg.provider === 'hash') return createHashEmbedder();
  const p = BASE[cfg.provider];
  if (!p || (p.key && !env[p.key])) return createHashEmbedder();
  return createOpenAiCompatibleEmbedder({ baseUrl: p.url(env), apiKey: p.key ? env[p.key] : undefined, model: cfg.model });
}
