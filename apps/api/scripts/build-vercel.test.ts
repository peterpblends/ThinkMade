import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRoutes, bundleApi } from './build-vercel';

const out = join(import.meta.dirname, '..', '..', '..', '.data', 'test-vercel-build');
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('buildRoutes', () => {
  const html = '<html><head><script>var a=1;</script><script type="module" src="/x.js"></script></head></html>';
  const routes = buildRoutes(html);

  it('sends /api requests to the api function', () => {
    expect(routes).toContainEqual({ src: '^/api(?:/.*)?$', dest: '/api' });
  });

  it('allows exactly the inline scripts in index.html by hash', () => {
    const hash = createHash('sha256').update('var a=1;').digest('base64');
    const csp = routes.find((r) => r.headers?.['Content-Security-Policy'])!.headers!['Content-Security-Policy']!;
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(csp).not.toContain("'unsafe-inline' 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('falls back to index.html for app routes after the filesystem', () => {
    const fsIndex = routes.findIndex((r) => r.handle === 'filesystem');
    expect(fsIndex).toBeGreaterThan(-1);
    expect(routes.slice(fsIndex)).toContainEqual({ src: '^/(?!api/).*$', dest: '/index.html' });
  });

  it('never caches the service worker', () => {
    expect(routes).toContainEqual(
      expect.objectContaining({ src: '^/sw\\.js$', headers: expect.objectContaining({ 'Cache-Control': 'no-cache' }) }),
    );
  });
});

describe('bundleApi', () => {
  it('produces a self-contained function that serves /api/health', async () => {
    const funcDir = join(out, 'api.func');
    mkdirSync(funcDir, { recursive: true });
    await bundleApi(funcDir);
    expect(existsSync(join(funcDir, 'index.mjs'))).toBe(true);
    const vc = JSON.parse(readFileSync(join(funcDir, '.vc-config.json'), 'utf8'));
    expect(vc).toMatchObject({ handler: 'index.mjs', launcherType: 'Nodejs' });
    expect(vc.runtime).toMatch(/^nodejs\d+\.x$/);

    process.env.PGLITE_DIR = ':memory:';
    process.env.AUTH_SECRET = 'bundle-test-secret-bundle-test-secret';
    const mod = await import(pathToFileURL(join(funcDir, 'index.mjs')).href);
    const server = createServer(mod.default);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 120_000);
});
