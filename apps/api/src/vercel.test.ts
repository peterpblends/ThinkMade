import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.PGLITE_DIR = ':memory:';
  process.env.AUTH_SECRET = 'vercel-entry-secret-vercel-entry-secret';
  const { default: listener } = await import('./vercel');
  server = createServer(listener);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('vercel entry', () => {
  it('handles a health request through a Node request listener', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves concurrent requests from one shared context', async () => {
    const results = await Promise.all([1, 2, 3].map(() => fetch(`${base}/api/settings/public`)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });
});
