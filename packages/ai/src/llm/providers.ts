import { createFakeLlm } from './fake';
import { createFallbackLlm } from './fallback';
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

/** Whether a provider can be used: it exists and its API key (if it needs one) is set. */
export function providerConfigured(provider: string, env: Env): boolean {
  const p = PROVIDERS[provider];
  return !!p && (!p.keyVar || !!env[p.keyVar]);
}

/** The environment variable holding a provider's API key, if it needs one. */
export function providerKeyVar(provider: string): string | undefined {
  return PROVIDERS[provider]?.keyVar;
}

/** A scripted responder used by `provider: 'fake'` (tests and local demos only). */
let fakeResponder: ((messages: ChatMessage[]) => string) | null = null;
export function setFakeResponder(fn: ((messages: ChatMessage[]) => string) | null) {
  fakeResponder = fn;
}

/** A further model to try when the first is out of allowance, from the stage's `tm_fallbacks` param. */
interface FallbackConfig {
  provider: string;
  model: string;
  params?: Record<string, unknown>;
}

/**
 * The stage's model, followed by any `tm_fallbacks` whose provider is configured (a fallback without an
 * API key is skipped, so optional providers cost nothing to list).
 */
export function createLlm(cfg: ModelConfig, env: Env = process.env): LlmClient {
  const primary = createSingleLlm(cfg, env);
  const fallbacks = Array.isArray(cfg.params?.tm_fallbacks) ? (cfg.params.tm_fallbacks as FallbackConfig[]) : [];
  const extra: LlmClient[] = [];
  for (const f of fallbacks) {
    if (!f || typeof f.provider !== 'string' || typeof f.model !== 'string') continue;
    try {
      extra.push(createSingleLlm({ provider: f.provider, model: f.model, params: f.params ?? {} }, env));
    } catch (err) {
      if (!(err instanceof ProviderNotConfiguredError)) throw err;
    }
  }
  return createFallbackLlm([primary, ...extra]);
}

function createSingleLlm(cfg: ModelConfig, env: Env): LlmClient {
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
