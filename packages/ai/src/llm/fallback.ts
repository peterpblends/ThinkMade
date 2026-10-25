import { LlmError, type ChatMessage, type ChatOptions, type LlmClient } from './types';

/**
 * Tries each client in turn until one answers: when the first free provider is out of allowance (or
 * failing), the next one is used. If every client is rate limited, the 429 with the soonest reset is
 * thrown, so the caller can wait; otherwise the first client's error is thrown.
 */
export function createFallbackLlm(clients: LlmClient[], log: (message: string) => void = (m) => console.info(m)): LlmClient {
  const [primary] = clients;
  if (!primary) throw new Error('createFallbackLlm needs at least one client');
  if (clients.length === 1) return primary;
  return {
    provider: primary.provider,
    model: primary.model,
    ...(primary.requestTokenLimit ? { requestTokenLimit: primary.requestTokenLimit } : {}),
    async chat(messages: ChatMessage[], options?: ChatOptions) {
      const errors: unknown[] = [];
      for (const [i, client] of clients.entries()) {
        try {
          const res = await client.chat(messages, options);
          if (i > 0) log(`[llm] ${primary.provider}/${primary.model} unavailable; answered by ${client.provider}/${client.model}`);
          return res;
        } catch (err) {
          errors.push(err);
          if (options?.signal?.aborted) throw err;
        }
      }
      const limited = errors.filter((e): e is LlmError => e instanceof LlmError && e.status === 429);
      if (limited.length === errors.length) {
        const waits = limited.map((e) => e.retryAfterMs).filter((w): w is number => typeof w === 'number');
        throw new LlmError(
          `All ${clients.length} AI providers are at their limits. ${(errors[0] as Error).message}`,
          429,
          waits.length ? Math.min(...waits) : undefined,
        );
      }
      throw errors[0];
    },
  };
}
