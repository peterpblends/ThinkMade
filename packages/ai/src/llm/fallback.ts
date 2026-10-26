import { LlmError, type ChatMessage, type ChatOptions, type LlmClient } from './types';

/**
 * Models that are resting: out of allowance until their limit resets, or missing (not found) for an hour.
 * Shared across requests in a process, so a worker doesn't spend a request on a model it knows can't answer.
 */
const resting = new Map<string, number>();
const key = (c: LlmClient) => `${c.provider}|${c.model}`;

/** Forgets every resting model (tests, and an administrator's "test" of a model). */
export function clearRestingModels() {
  resting.clear();
}

/** How long a failure means the model should rest, in milliseconds (0: try it again next time). */
function restFor(err: unknown): number {
  if (!(err instanceof LlmError)) return 0;
  if (err.status === 429) return err.retryAfterMs && err.retryAfterMs > 60_000 ? err.retryAfterMs : 60_000;
  if (err.status === 404 || (err.status === 400 && /model/i.test(err.message) && /not (?:exist|found|available|supported)|decommissioned|invalid model/i.test(err.message))) return 3_600_000;
  return 0;
}

/**
 * Tries each client in turn until one answers: when the first free provider is out of allowance (or
 * failing, or its model has gone), the next one is used. Models known to be resting are skipped without a
 * request. If every client is rate limited or resting, the 429 with the soonest reset is thrown, so the
 * caller can wait; otherwise the first client's error is thrown.
 */
export function createFallbackLlm(clients: LlmClient[], log: (message: string) => void = (m) => console.info(m), now: () => number = Date.now): LlmClient {
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
        const until = resting.get(key(client)) ?? 0;
        if (until > now()) {
          errors.push(new LlmError(`${client.provider}/${client.model} is resting after reaching its limit`, 429, until - now()));
          continue;
        }
        try {
          const res = await client.chat(messages, options);
          resting.delete(key(client));
          if (i > 0) log(`[llm] ${primary.provider}/${primary.model} unavailable; answered by ${client.provider}/${client.model}`);
          return res;
        } catch (err) {
          errors.push(err);
          if (options?.signal?.aborted) throw err;
          const rest = restFor(err);
          if (rest) {
            resting.set(key(client), now() + rest);
            log(`[llm] ${client.provider}/${client.model} rests for ${Math.round(rest / 60_000)} min: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
          }
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
      // Report the first real failure (not a resting skip), so a broken setting is visible.
      throw errors.find((e) => !(e instanceof LlmError && e.status === 429)) ?? errors[0];
    },
  };
}
