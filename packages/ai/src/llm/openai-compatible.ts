import { LlmError, type ChatMessage, type ChatOptions, type ChatResult, type LlmClient } from './types';

export interface OpenAiCompatibleConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Extra headers some providers want (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
}

/** Works with Groq, OpenRouter, Ollama, vLLM and Gemini's OpenAI-compatible endpoint. */
export function createOpenAiCompatibleLlm(cfg: OpenAiCompatibleConfig): LlmClient {
  const doFetch = cfg.fetch ?? fetch;
  return {
    provider: cfg.provider,
    model: cfg.model,
    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...cfg.headers };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const body: Record<string, unknown> = { model: cfg.model, messages };
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
      if (options.json) body.response_format = { type: 'json_object' };
      const signal = options.signal ?? AbortSignal.timeout(cfg.timeoutMs ?? 180_000);
      let res: Response;
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
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new LlmError(`${cfg.provider} returned ${res.status}: ${detail}`, res.status);
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
