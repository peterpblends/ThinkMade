import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRoutes, bundleApi, migrateForProduction, staticExternalImports, storageCorsForProduction, storageOrigins } from './build-vercel';

const out = join(import.meta.dirname, '..', '..', '..', '.data', 'test-vercel-build');
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('buildRoutes', () => {
  const html = '<html><head><script>var a=1;</script><script type="module" src="/x.js"></script></head></html>';
  const routes = buildRoutes(html);

  it('sends /api requests and shared links to the api function', () => {
    expect(routes).toContainEqual({ src: '^/api(?:/.*)?$', dest: '/api' });
    const share = routes.find((r) => r.dest === '/api' && r.src?.startsWith('^/p/'))!;
    // A shared podcast and a shared episode are both rendered by the API (for link previews).
    for (const path of ['/p/heart-and-faith', '/p/heart-and-faith/', '/p/heart-and-faith/e/3']) expect(new RegExp(share.src!).test(path), path).toBe(true);
    expect(new RegExp(share.src!).test('/p/heart-and-faith/e/x')).toBe(false);
  });

  it('allows exactly the inline scripts in index.html by hash', () => {
    const hash = createHash('sha256').update('var a=1;').digest('base64');
    const csp = routes.find((r) => r.headers?.['Content-Security-Policy'])!.headers!['Content-Security-Policy']!;
    expect(csp).toContain(`script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`);
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

describe('staticExternalImports', () => {
  it('flags left-out packages imported at the top level, but not dynamic imports or bundled ones', () => {
    const bundle = [
      'import { PGlite } from "@electric-sql/pglite";',
      'import { Pool } from "pg";',
      'const k = await import("kokoro-js");',
    ].join('\n');
    expect(staticExternalImports(bundle)).toEqual(['@electric-sql/pglite']);
  });
});

describe('migrateForProduction', () => {
  it('only migrates production builds that have a database', async () => {
    expect(await migrateForProduction({ VERCEL_ENV: 'preview', DATABASE_URL: 'postgres://x' })).toBe(false);
    expect(await migrateForProduction({ VERCEL_ENV: 'production' })).toBe(false);
  });
});

describe('storageOrigins', () => {
  it('accepts endpoints with or without https:// and allows path and virtual-hosted styles', () => {
    expect(storageOrigins('s3.us-east-005.backblazeb2.com', 'tm')).toEqual(['https://s3.us-east-005.backblazeb2.com', 'https://tm.s3.us-east-005.backblazeb2.com']);
    expect(storageOrigins('https://x.r2.cloudflarestorage.com/')).toEqual(['https://x.r2.cloudflarestorage.com']);
    expect(storageOrigins(undefined)).toEqual([]);
  });
});

describe('storageCorsForProduction', () => {
  it('only touches the bucket on production builds with storage configured', async () => {
    expect(await storageCorsForProduction({ VERCEL_ENV: 'preview' })).toMatch(/skipped/);
    expect(await storageCorsForProduction({ VERCEL_ENV: 'production', APP_URL: 'https://x.test' })).toMatch(/skipped/);
  });
});
