import { LlmError, textOf, type ChatMessage, type ChatOptions, type ChatResult, type LlmClient } from './types';

export interface OpenAiCompatibleConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Extra headers some providers want (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
  /** Extra request fields from the admin model settings, e.g. `reasoning_effort`. */
  params?: Record<string, unknown>;
  /**
   * Most tokens one request may ask for, prompt plus `max_tokens` (Groq's free tier refuses any request
   * over its per-minute limit). Output is shortened to fit.
   */
  requestTokenLimit?: number;
  /** For tests: how to wait before retrying a short rate limit. */
  sleep?: (ms: number) => Promise<void>;
}

/** Longest wait for a per-minute limit to reset before giving the 429 back to the caller (the job queue). */
const MAX_INLINE_WAIT_MS = 90_000;
const MAX_INLINE_RETRIES = 4;

/** Seconds until a rate limit resets, from `retry-after` ("12" or a date) or Groq's "1m2.5s"-style reset headers. */
export function retryAfterMs(headers: Headers): number | null {
  const ra = headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return secs * 1000;
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  const reset = headers.get('x-ratelimit-reset-tokens') ?? headers.get('x-ratelimit-reset-requests');
  const m = reset?.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/);
  if (!m || !reset) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0);
}

/** A deliberately high estimate (about 3.5 characters a token), so requests stay under hard limits. */
export function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + 10 + Math.ceil(textOf(m.content).length / 3.5), 0);
}

/** Fields ThinkMade sets itself; admin params can't override them. */
const RESERVED = new Set(['model', 'messages', 'stream', 'n', 'response_format', 'max_tokens', 'temperature', 'tools']);
// (`tm_` params, such as tm_fallbacks and tm_request_token_limit, are ThinkMade settings and never sent.)

/** Works with Groq, OpenRouter, Ollama, vLLM and Gemini's OpenAI-compatible endpoint. */
export function createOpenAiCompatibleLlm(cfg: OpenAiCompatibleConfig): LlmClient {
  const doFetch = cfg.fetch ?? fetch;
  return {
    provider: cfg.provider,
    model: cfg.model,
    ...(cfg.requestTokenLimit ? { requestTokenLimit: cfg.requestTokenLimit } : {}),
    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...cfg.headers };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const body: Record<string, unknown> = { model: cfg.model, messages };
      // `tm_` params are ThinkMade settings, not provider fields.
      for (const [k, v] of Object.entries(cfg.params ?? {})) if (!RESERVED.has(k) && !k.startsWith('tm_')) body[k] = v;
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
      if (cfg.requestTokenLimit) {
        const room = cfg.requestTokenLimit - estimateTokens(messages);
        if (room < 512) throw new LlmError(`This request is too large for ${cfg.model}'s per-minute token limit.`, 413);
        body.max_tokens = Math.min(options.maxTokens ?? room, room);
      }
      if (options.json) body.response_format = { type: 'json_object' };
      const signal = options.signal ?? AbortSignal.timeout(cfg.timeoutMs ?? 180_000);
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
          });
        } catch (err) {
          throw new LlmError(`${cfg.provider} request failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // A per-minute limit resets within seconds: wait here rather than requeueing the whole job.
        // Daily limits (long waits) go back to the caller as a 429.
        const wait = res.status === 429 ? retryAfterMs(res.headers) : null;
        if (wait === null || wait > MAX_INLINE_WAIT_MS || attempt >= MAX_INLINE_RETRIES) break;
        await res.body?.cancel().catch(() => {});
        await (cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait + 250);
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new LlmError(`${cfg.provider} returned ${res.status}: ${detail}`, res.status, res.status === 429 ? (retryAfterMs(res.headers) ?? undefined) : undefined);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError(`${cfg.provider} returned no message content`);
      return {
        content,
        usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
