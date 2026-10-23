/**
 * Assembles a Vercel Build Output API v3 directory (.vercel/output):
 *   static/            the built PWA (apps/web/dist)
 *   functions/api.func one bundled Node function serving every /api route
 *   config.json        routing, security headers and SPA fallback
 * Run after `npm run build -w apps/web`. Vercel uses .vercel/output when the build command creates it.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

export const NODE_RUNTIME = 'nodejs22.x';

export interface Route {
  src?: string;
  dest?: string;
  handle?: 'filesystem';
  headers?: Record<string, string>;
  continue?: boolean;
}

/** sha256 hashes of every classic inline <script> in the page, for a CSP without 'unsafe-inline'. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = m[1] ?? '';
    if (body.trim()) hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

/** connectOrigins: object-store origins the browser talks to directly (presigned uploads and downloads). */
export function buildRoutes(indexHtml: string, opts: { connectOrigins?: string[] } = {}): Route[] {
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets on-device speech recognition compile WebAssembly; it does not allow eval().
    `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptHashes(indexHtml).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    ["connect-src 'self'", ...(opts.connectOrigins ?? [])].join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  return [
    {
      src: '^/(.*)$',
      headers: {
        'Content-Security-Policy': csp,
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      continue: true,
    },
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    // On-device speech model files: pinned versions, also kept by the browser's Cache API.
    { src: '^/speech/(.*)$', headers: { 'Cache-Control': 'public, max-age=604800' }, continue: true },
    { src: '^/manifest\\.webmanifest$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    { src: '^/api(?:/.*)?$', dest: '/api' },
    // Shared links are rendered by the API so link previews show the series title and description.
    { src: '^/p/[^/]+/?$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/(?!api/).*$', dest: '/index.html' },
  ];
}

/** Packages left out of the function. Each may only be loaded with a dynamic import() on a path production never takes. */
export const API_EXTERNALS = [
  '@electric-sql/pglite', '@electric-sql/pglite-pgvector', 'drizzle-orm/pglite', 'pg-native',
  '@thinkmade/worker', 'kokoro-js', 'phonon-tts', 'phonon-tts/raw', '@huggingface/transformers', 'onnxruntime-node', 'onnxruntime-web', 'sharp', 'ffmpeg-static',
] as const;

/** Static imports of left-out packages: these would crash the function as it loads. */
export function staticExternalImports(bundle: string): string[] {
  const found = new Set<string>();
  for (const m of bundle.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
    if ((API_EXTERNALS as readonly string[]).includes(m[1]!)) found.add(m[1]!);
  }
  return [...found];
}

/** Bundles the API into one ESM file. PGlite stays external: production always uses Postgres. */
export async function bundleApi(funcDir: string, indexHtml?: string): Promise<void> {
  await build({
    entryPoints: [join(root, 'apps', 'api', 'src', 'vercel.ts')],
    outfile: join(funcDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    legalComments: 'none',
    // The function never runs jobs or speech synthesis, so the worker and native AI libraries stay out.
    external: [...API_EXTERNALS],
    define: { __THINKMADE_MIGRATIONS_REL__: '"./migrations"', ...(indexHtml ? { __THINKMADE_INDEX_HTML__: JSON.stringify(indexHtml) } : {}) },
    banner: {
      js: "import { createRequire as __tmCreateRequire } from 'node:module'; const require = __tmCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
  const bad = staticExternalImports(readFileSync(join(funcDir, 'index.mjs'), 'utf8'));
  if (bad.length) throw new Error(`The API bundle statically imports packages Vercel won't have: ${bad.join(', ')}. Load them with import() or add their importer to API_EXTERNALS.`);
  cpSync(join(root, 'packages', 'db', 'migrations'), join(funcDir, 'migrations'), { recursive: true });
  writeFileSync(join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
  writeFileSync(
    join(funcDir, '.vc-config.json'),
    JSON.stringify(
      { runtime: NODE_RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 30 },
      null,
      2,
    ) + '\n',
  );
}

export async function assemble(opts: { webDist: string; outDir: string }): Promise<void> {
  const indexPath = join(opts.webDist, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`Missing ${indexPath}. Run "npm run build -w apps/web" first.`);
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  cpSync(opts.webDist, join(opts.outDir, 'static'), { recursive: true });
  const funcDir = join(opts.outDir, 'functions', 'api.func');
  mkdirSync(funcDir, { recursive: true });
  const indexHtml = readFileSync(indexPath, 'utf8');
  await bundleApi(funcDir, indexHtml);
  // The browser PUTs uploads and fetches downloads directly from R2, so CSP must allow its origin.
  // Presigned URLs are path-style (forcePathStyle), so their origin is the endpoint's origin.
  // S3_ENDPOINT must be set as a Vercel environment variable so it is present at build time.
  const routes = buildRoutes(indexHtml, { connectOrigins: process.env.S3_ENDPOINT ? [new URL(process.env.S3_ENDPOINT).origin] : [] });
  writeFileSync(join(opts.outDir, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await assemble({ webDist: join(root, 'apps', 'web', 'dist'), outDir: join(root, '.vercel', 'output') });
  console.info('[vercel] wrote .vercel/output');
}
