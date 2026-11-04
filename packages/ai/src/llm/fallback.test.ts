import { beforeEach, describe, expect, it } from 'vitest';
import { clearRestingModels, createFallbackLlm } from './fallback';
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

beforeEach(() => clearRestingModels());

describe('createFallbackLlm', () => {
  it('uses the next provider when the first is out of allowance, and logs it', async () => {
    const logs: string[] = [];
    const a = client('groq', limited(3_600_000));
    const b = client('openrouter', () => 'from b');
    const llm = createFallbackLlm([a, b], (m) => logs.push(m));
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from b');
    expect(logs).toContainEqual(expect.stringMatching(/answered by openrouter/));
  });

  it('skips a model that is out of allowance until its limit resets, without spending a request on it', async () => {
    let t = 0;
    const a = client('groq', limited(3_600_000));
    const b = client('gemini', () => 'from gemini');
    const llm = createFallbackLlm([a, b], () => {}, () => t);
    await llm.chat([{ role: 'user', content: 'one' }]);
    await llm.chat([{ role: 'user', content: 'two' }]);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(2);
    t = 3_600_001; // the allowance has reset
    await llm.chat([{ role: 'user', content: 'three' }]);
    expect(a.calls).toBe(2);
  });

  it("rests a model that doesn't exist, so a misconfigured setting falls straight through to a backup", async () => {
    const missing = client('groq', () => {
      throw new LlmError('groq returned 404: The model `gemma-4-31b-it:free` does not exist', 404);
    });
    const backup = client('openrouter', () => 'from backup');
    const llm = createFallbackLlm([missing, backup], () => {});
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from backup');
    await llm.chat([{ role: 'user', content: 'again' }]);
    expect(missing.calls).toBe(1);
  });

  it('when every provider is rate limited, reports the soonest reset so the job can wait', async () => {
    const llm = createFallbackLlm([client('a', limited(7_200_000)), client('b', limited(1_800_000)), client('c', limited())]);
    await expect(llm.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 429, retryAfterMs: 1_800_000 });
  });

  it('waits rather than fails when one provider is limited and another is broken', async () => {
    const llm = createFallbackLlm([
      client('a', () => {
        throw new LlmError('502 upstream error', 502);
      }),
      client('b', limited(1_800_000)),
    ]);
    const err = await llm.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 1_800_000 });
    expect((err as Error).message).toContain('502 upstream error');
  });

  it("throws the first provider's error when none is merely limited", async () => {
    const llm = createFallbackLlm([
      client('a', () => {
        throw new LlmError('401 bad key', 401);
      }),
      client('b', () => {
        throw new LlmError('500 boom', 500);
      }),
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

  it('goes back to a model as soon as its per-minute limit resets, and gives a stalled model a rest', async () => {
    let t = 0;
    let first = 0;
    const a = client('groq', () => (first++ === 0 ? limited(5_000)() : 'from groq'));
    const b = client('gemini', () => 'from gemini');
    const llm = createFallbackLlm([a, b], () => {}, () => t);
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from gemini');
    t = 3_000;
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from gemini');
    t = 5_500;
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('from groq');

    clearRestingModels();
    const slow = client('gemini', () => {
      throw new LlmError('too slow to start answering', 504);
    });
    const c = client('openrouter', () => 'from openrouter');
    const chain = createFallbackLlm([slow, c], () => {}, () => t);
    await chain.chat([{ role: 'user', content: 'hi' }]);
    t += 60_000;
    await chain.chat([{ role: 'user', content: 'hi' }]);
    expect(slow.calls).toBe(1);
  });
});
