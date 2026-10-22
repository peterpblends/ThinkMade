import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { completeJson } from './structured';
import { createFakeLlm } from './fake';
import { createOpenAiCompatibleLlm } from './openai-compatible';
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
