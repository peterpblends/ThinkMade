import { createFakeLlm } from './fake';
import { createOpenAiCompatibleLlm } from './openai-compatible';
import type { ChatMessage, LlmClient } from './types';

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}

export interface ModelConfig {
  provider: string;
  model: string;
  params?: Record<string, unknown>;
}

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<string, { baseUrl: (env: Env) => string; keyVar?: string; label: string }> = {
  groq: { label: 'Groq', baseUrl: () => 'https://api.groq.com/openai/v1', keyVar: 'GROQ_API_KEY' },
  openrouter: { label: 'OpenRouter', baseUrl: () => 'https://openrouter.ai/api/v1', keyVar: 'OPENROUTER_API_KEY' },
  gemini: { label: 'Gemini', baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai', keyVar: 'GEMINI_API_KEY' },
  ollama: { label: 'Ollama', baseUrl: (env) => env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1' },
};

export const LLM_PROVIDERS = Object.keys(PROVIDERS);

/** A scripted responder used by `provider: 'fake'` (tests and local demos only). */
let fakeResponder: ((messages: ChatMessage[]) => string) | null = null;
export function setFakeResponder(fn: ((messages: ChatMessage[]) => string) | null) {
  fakeResponder = fn;
}

export function createLlm(cfg: ModelConfig, env: Env = process.env): LlmClient {
  if (cfg.provider === 'fake') {
    if (env.NODE_ENV === 'production') throw new ProviderNotConfiguredError('The fake provider is not allowed in production.');
    if (!fakeResponder) throw new ProviderNotConfiguredError('No fake responder registered.');
    return createFakeLlm(fakeResponder, cfg.model);
  }
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new ProviderNotConfiguredError(`Unknown language model provider "${cfg.provider}".`);
  const apiKey = p.keyVar ? env[p.keyVar] : undefined;
  if (p.keyVar && !apiKey) {
    throw new ProviderNotConfiguredError(`${p.label} is selected but ${p.keyVar} is not set.`);
  }
  return createOpenAiCompatibleLlm({
    provider: cfg.provider,
    baseUrl: p.baseUrl(env),
    apiKey,
    model: cfg.model,
    ...(cfg.params ? { params: cfg.params } : {}),
    ...(typeof cfg.params?.tm_request_token_limit === 'number' ? { requestTokenLimit: cfg.params.tm_request_token_limit } : {}),
    ...(cfg.provider === 'openrouter'
      ? { headers: { 'HTTP-Referer': 'https://thinkmade.zicaworld.com', 'X-Title': 'ThinkMade' } }
      : {}),
  });
}
