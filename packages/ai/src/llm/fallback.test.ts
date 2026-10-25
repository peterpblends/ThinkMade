import { describe, expect, it } from 'vitest';
import { createFallbackLlm } from './fallback';
import { createLlm } from './providers';
import { LlmError, type LlmClient } from './types';

const client = (name: string, behaviour: () => string): LlmClient & { calls: number } => {
  const c = {
    provider: name,
    model: `${name}-model`,
    calls: 0,
    async chat() {
      c.calls++;
      return { content: behaviour(), usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
  return c;
};
const limited = (ms?: number) => () => {
  throw new LlmError('429 daily limit', 429, ms);
};

describe('createFallbackLlm', () => {
  it('uses the next provider when the first is out of allowance, and logs it', async () => {
    const logs: string[] = [];
    const a = client('groq', limited(3_600_000));
    const b = client('openrouter', () => 'from b');
    const llm = createFallbackLlm([a, b], (m) => logs.push(m));
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from b');
    expect(logs[0]).toMatch(/answered by openrouter/);
  });

  it('when every provider is rate limited, reports the soonest reset so the job can wait', async () => {
    const llm = createFallbackLlm([client('a', limited(7_200_000)), client('b', limited(1_800_000)), client('c', limited())]);
    await expect(llm.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 429, retryAfterMs: 1_800_000 });
  });

  it("otherwise throws the first provider's error", async () => {
    const llm = createFallbackLlm([
      client('a', () => {
        throw new LlmError('401 bad key', 401);
      }),
      client('b', limited()),
    ]);
    await expect(llm.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 401 });
  });
});

describe('createLlm with tm_fallbacks', () => {
  it('skips fallbacks whose provider has no key', () => {
    const llm = createLlm(
      { provider: 'groq', model: 'openai/gpt-oss-120b', params: { tm_fallbacks: [{ provider: 'gemini', model: 'g' }, { provider: 'openrouter', model: 'o:free' }] } },
      { GROQ_API_KEY: 'k' },
    );
    expect(llm.provider).toBe('groq'); // only the primary had a key, so no wrapper is needed
  });
});
