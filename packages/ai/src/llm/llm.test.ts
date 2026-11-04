import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { completeJson } from './structured';
import { createFakeLlm } from './fake';
import { createOpenAiCompatibleLlm, estimateTokens, retryAfterMs } from './openai-compatible';
import { createLlm, ProviderNotConfiguredError } from './providers';

describe('completeJson', () => {
  const schema = z.object({ answer: z.number() });

  it('parses valid JSON on the first try', async () => {
    const llm = createFakeLlm(() => '{"answer": 42}');
    const { data } = await completeJson(llm, [{ role: 'user', content: 'q' }], schema);
    expect(data).toEqual({ answer: 42 });
  });

  it('re-prompts with the validation error and succeeds', async () => {
    const seen: string[] = [];
    let n = 0;
    const llm = createFakeLlm((messages) => {
      seen.push(String(messages.at(-1)!.content));
      return n++ === 0 ? '{"answer": "nope"}' : '{"answer": 7}';
    });
    const { data, attempts } = await completeJson(llm, [{ role: 'user', content: 'q' }], schema);
    expect(data.answer).toBe(7);
    expect(attempts).toBe(2);
    expect(seen[1]).toMatch(/did not match the required format/i);
  });

  it('extracts JSON wrapped in prose or code fences', async () => {
    const llm = createFakeLlm(() => 'Sure!\n```json\n{"answer": 1}\n```');
    expect((await completeJson(llm, [{ role: 'user', content: 'q' }], schema)).data.answer).toBe(1);
  });

  it('ignores a reasoning preamble in <think> tags', async () => {
    const llm = createFakeLlm(() => '<think>{"answer": 0} maybe?</think>{"answer": 3}');
    expect((await completeJson(llm, [{ role: 'user', content: 'q' }], schema)).data.answer).toBe(3);
  });

  it('gives up after the retry budget with a clear error', async () => {
    const llm = createFakeLlm(() => 'not json at all');
    await expect(completeJson(llm, [{ role: 'user', content: 'q' }], schema, { retries: 1 })).rejects.toThrow(
      /after 2 attempts/,
    );
  });
});

describe('createOpenAiCompatibleLlm', () => {
  it('posts an OpenAI-style request with JSON mode and returns content and usage', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm', fetch: fetchFn });
    const res = await llm.chat([{ role: 'user', content: 'hi' }], { json: true, temperature: 0.2 });
    expect(res.content).toBe('{"ok":true}');
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(captured!.url).toBe('https://api.example/v1/chat/completions');
    expect(new Headers(captured!.init.headers).get('authorization')).toBe('Bearer k');
    const body = JSON.parse(String(captured!.init.body));
    expect(body).toMatchObject({ model: 'm', temperature: 0.2, response_format: { type: 'json_object' } });
  });

  it('streams a reply piece by piece, even when a chunk splits across network packets', async () => {
    let sent: Record<string, unknown> = {};
    const events = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"lo there."}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    ];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(e)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', model: 'm', fetch: fetchFn });
    const pieces: string[] = [];
    const res = await llm.chat([{ role: 'user', content: 'hi' }], { onToken: (t) => pieces.push(t) });
    expect(sent).toMatchObject({ stream: true });
    expect(pieces).toEqual(['Hel', 'lo there.']);
    expect(res).toEqual({ content: 'Hello there.', usage: { promptTokens: 7, completionTokens: 3 } });
  });

  it('passes a whole reply on at once from a provider that does not stream', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'All at once.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', model: 'm', fetch: fetchFn });
    const pieces: string[] = [];
    expect((await llm.chat([{ role: 'user', content: 'hi' }], { onToken: (t) => pieces.push(t) })).content).toBe('All at once.');
    expect(pieces).toEqual(['All at once.']);
  });

  it('adds admin params such as reasoning effort but never lets them override core fields', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 });
    }) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm', fetch: fetchFn, params: { reasoning_effort: 'low', model: 'evil', max_tokens: 1 } });
    await llm.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
    expect(body).toMatchObject({ model: 'm', reasoning_effort: 'low', max_tokens: 50 });
  });

  it('keeps prompt plus output under a provider request limit, and never sends tm_ settings', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 });
    }) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm', fetch: fetchFn, requestTokenLimit: 7500, params: { tm_request_token_limit: 7500 } });
    const big = [{ role: 'user' as const, content: 'word '.repeat(4000) }];
    await llm.chat(big, { maxTokens: 6000 });
    expect(bodies[0]!.max_tokens).toBe(7500 - estimateTokens(big));
    expect(bodies[0]).not.toHaveProperty('tm_request_token_limit');
    await llm.chat([{ role: 'user', content: 'hi' }], { maxTokens: 100 });
    expect(bodies[1]!.max_tokens).toBe(100);
    await expect(llm.chat([{ role: 'user', content: 'word '.repeat(6000) }], { maxTokens: 100 })).rejects.toMatchObject({ status: 413 });
  });

  it('waits out a short per-minute rate limit, but hands a long one back', async () => {
    const waits: number[] = [];
    let n = 0;
    const fetchFn = (async () =>
      n++ === 0
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm', fetch: fetchFn, sleep: async (ms) => void waits.push(ms) });
    expect((await llm.chat([{ role: 'user', content: 'hi' }])).content).toBe('ok');
    expect(waits).toEqual([7250]);

    const daily = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', sleep: async () => {}, fetch: (async () => new Response('daily', { status: 429, headers: { 'x-ratelimit-reset-tokens': '2h10m' } })) as typeof fetch });
    await expect(daily.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 429 });
  });

  it('abandons a model that has not started answering in time, so the next one can', async () => {
    const stuck = (async (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'gemini', baseUrl: 'https://x/v1', apiKey: 'k', model: 'slow', fetch: stuck });
    const t0 = Date.now();
    await expect(llm.chat([{ role: 'user', content: 'hi' }], { firstTokenTimeoutMs: 50, onToken: () => {} })).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('hands even a short limit back at once when someone is waiting in a conversation', async () => {
    const waits: number[] = [];
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', sleep: async (ms) => void waits.push(ms), fetch: (async () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })) as typeof fetch });
    await expect(llm.chat([{ role: 'user', content: 'hi' }], { maxRateLimitWaitMs: 1500 })).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([]);
  });

  it('reads Groq reset headers', () => {
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset-tokens': '7.66s' }))).toBeCloseTo(7660);
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset-tokens': '1m2.5s' }))).toBe(62_500);
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset-requests': '250ms' }))).toBe(250);
    expect(retryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(retryAfterMs(new Headers())).toBeNull();
  });

  it('surfaces provider errors with status', async () => {
    const fetchFn = (async () => new Response('slow down', { status: 429 })) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({ provider: 'groq', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm', fetch: fetchFn });
    await expect(llm.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 429 });
  });
});

describe('createLlm', () => {
  it('refuses Groq without an API key and names the variable', () => {
    expect(() => createLlm({ provider: 'groq', model: 'm' }, {})).toThrow(ProviderNotConfiguredError);
    expect(() => createLlm({ provider: 'groq', model: 'm' }, {})).toThrow(/GROQ_API_KEY/);
  });

  it('builds Ollama from its base URL without a key', () => {
    const llm = createLlm({ provider: 'ollama', model: 'llama3.2' }, { OLLAMA_BASE_URL: 'http://localhost:11434/v1' });
    expect(llm.provider).toBe('ollama');
  });

  it('never allows the fake provider in production', () => {
    expect(() => createLlm({ provider: 'fake', model: 'x' }, { NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  });
});
