export const EMBED_DIMS = 512;

/** Search queries and indexed documents are embedded differently by task-steered models. */
export type EmbedKind = 'query' | 'document';

export interface Embedder {
  /** Identifies the vector space, e.g. "embeddinggemma-2@512". Stored beside each vector. */
  readonly name: string;
  /** Unit-length vectors of EMBED_DIMS numbers, one per input. Defaults to documents. */
  embed(texts: string[], kind?: EmbedKind): Promise<number[][]>;
}

/** The configured embedder can't run here (for example the local model on Vercel). */
export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedderUnavailableError';
  }
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
    name: `hash@${EMBED_DIMS}`,
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
export function createOpenAiCompatibleEmbedder(cfg: {
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  fetch?: typeof fetch;
  /** Overrides the reported vector-space name (the worker's server reports its local model's). */
  name?: string;
  timeoutMs?: number;
}): Embedder {
  const doFetch = cfg.fetch ?? fetch;
  return {
    name: cfg.name ?? `api:${cfg.model}@${EMBED_DIMS}`,
    async embed(texts, kind = 'document') {
      const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, input: texts, dimensions: EMBED_DIMS, input_type: kind }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
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

export const GEMMA_MODEL = 'onnx-community/embeddinggemma-2-ONNX';
const GEMMA_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
const GEMMA_PROMPTS: Record<EmbedKind, string> = { query: 'task: search result | query: ', document: 'title: none | text: ' };

/**
 * EmbeddingGemma 2 (Apache-2.0) text encoder on CPU through Transformers.js, q4 (about 210 MB,
 * downloaded once). Its 768-dimension Matryoshka vectors are truncated to EMBED_DIMS and re-normalised.
 */
export function createGemmaEmbedder(options: { cacheDir?: string | undefined } = {}): Embedder {
  // One loaded model per process: callers may ask for an embedder on every request.
  const key = options.cacheDir ?? '';
  let shared = gemmaInstances.get(key);
  if (!shared) gemmaInstances.set(key, (shared = loadGemma(options)));
  return shared;
}

const gemmaInstances = new Map<string, Embedder>();

function loadGemma(options: { cacheDir?: string | undefined }): Embedder {
  type Extractor = (texts: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
  let extractor: Promise<Extractor> | null = null;
  const load = () =>
    (extractor ??= (async () => {
      const t = await import('@huggingface/transformers');
      if (options.cacheDir) t.env.cacheDir = options.cacheDir;
      return (await t.pipeline('feature-extraction', GEMMA_MODEL, { dtype: 'q4', device: 'cpu', revision: GEMMA_REVISION })) as unknown as Extractor;
    })().catch((err) => {
      extractor = null; // let a later call retry
      throw err;
    }));
  return {
    name: `embeddinggemma-2@${EMBED_DIMS}`,
    async embed(texts, kind = 'document') {
      const run = await load();
      // Long documents are cut well inside the 8K-token window; search text front-loads titles.
      const out = await run(texts.map((x) => GEMMA_PROMPTS[kind] + x.slice(0, 12_000)), { pooling: 'mean', normalize: true });
      return out.tolist().map((v) => normalise(v.slice(0, EMBED_DIMS)));
    },
  };
}

/** An embedder that always refuses, so callers fall back to text-only search. */
function unavailableEmbedder(name: string, reason: string): Embedder {
  return {
    name,
    async embed() {
      throw new EmbedderUnavailableError(reason);
    },
  };
}

/**
 * The configured embedder, falling back to the built-in hash embedder when an API key is missing.
 * `local` runs EmbeddingGemma 2 in this process, or calls the worker's embedding server when
 * EMBED_SERVER_URL is set; on Vercel without that server, it is unavailable.
 */
export function createEmbedder(cfg: { provider: string; model: string } | null, env: Record<string, string | undefined>): Embedder {
  if (!cfg || cfg.provider === 'hash') return createHashEmbedder();
  if (cfg.provider === 'local') {
    const local = createGemmaEmbedder({ cacheDir: env.MODEL_CACHE_DIR ? `${env.MODEL_CACHE_DIR}/transformers` : undefined });
    if (env.EMBED_SERVER_URL) {
      return createOpenAiCompatibleEmbedder({ baseUrl: env.EMBED_SERVER_URL, apiKey: env.EMBED_SERVER_TOKEN, model: GEMMA_MODEL, name: local.name, timeoutMs: 5_000 });
    }
    if (env.VERCEL) return unavailableEmbedder(local.name, 'EMBED_SERVER_URL is not set, and the embedding model cannot run on Vercel.');
    return local;
  }
  const p = BASE[cfg.provider];
  if (!p || (p.key && !env[p.key])) return createHashEmbedder();
  return createOpenAiCompatibleEmbedder({ baseUrl: p.url(env), apiKey: p.key ? env[p.key] : undefined, model: cfg.model });
}
