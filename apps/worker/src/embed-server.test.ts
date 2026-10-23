import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHashEmbedder } from '@thinkmade/ai';
import { createEmbedServer } from './embed-server';

const token = 'x'.repeat(40);
const kinds: string[] = [];
const base = createHashEmbedder();
const server = createEmbedServer({ name: base.name, embed: (t, k) => (kinds.push(k ?? 'document'), base.embed(t)) }, { token });
let url = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (body: unknown, auth = `Bearer ${token}`) =>
  fetch(`${url}/v1/embeddings`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('embedding server', () => {
  it('returns OpenAI-style vectors and passes the query kind through', async () => {
    const res = await post({ input: ['find me something on habits'], input_type: 'query' });
    const json = (await res.json()) as { model: string; data: Array<{ embedding: number[] }> };
    expect(res.status).toBe(200);
    expect(json.model).toBe('hash@512');
    expect(json.data[0]!.embedding).toHaveLength(512);
    expect(kinds.at(-1)).toBe('query');
  });

  it('refuses a missing or wrong token', async () => {
    expect((await post({ input: ['a'] }, '')).status).toBe(401);
    expect((await post({ input: ['a'] }, `Bearer ${'y'.repeat(40)}`)).status).toBe(401);
  });

  it('refuses bad, oversized or too many inputs, and other paths', async () => {
    expect((await post('{')).status).toBe(400);
    expect((await post({ input: Array(33).fill('a') })).status).toBe(400);
    expect((await post({ input: ['a'.repeat(5000)] })).status).toBe(400);
    expect((await post({ input: ['a'.repeat(70_000)] }).catch(() => ({ status: 413 }))).status).toBe(413);
    expect((await fetch(`${url}/anything`)).status).toBe(404);
  });

  it('will not start with a short token', () => {
    expect(() => createEmbedServer(base, { token: 'short' })).toThrow(/32 characters/);
  });
});
