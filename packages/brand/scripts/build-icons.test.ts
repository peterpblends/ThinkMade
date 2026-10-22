import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRAND } from '@thinkmade/shared';
import { buildBrand, renderSvg, type BuildResult } from './build-icons';
import { appIconMaskableSvg } from '../src/logo';

let out: string;
let result: BuildResult;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'tm-brand-'));
  result = await buildBrand({ publicDir: join(out, 'public'), assetsDir: join(out, 'assets') });
});

function pngWidth(file: string): number {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return buf.readUInt32BE(16);
}

describe('buildBrand', () => {
  it('renders every required icon size', () => {
    const expected: Array<[string, number]> = [
      ['icons/icon-48.png', 48], ['icons/icon-72.png', 72], ['icons/icon-96.png', 96],
      ['icons/icon-128.png', 128], ['icons/icon-144.png', 144], ['icons/icon-192.png', 192],
      ['icons/icon-256.png', 256], ['icons/icon-384.png', 384], ['icons/icon-512.png', 512],
      ['icons/maskable-192.png', 192], ['icons/maskable-512.png', 512],
      ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['favicon-16.png', 16],
      ['social-card.png', 1200],
    ];
    for (const [file, width] of expected) {
      const path = join(out, 'public', file);
      expect(existsSync(path), file).toBe(true);
      expect(pngWidth(path), file).toBe(width);
    }
    expect(existsSync(join(out, 'public', 'favicon.svg'))).toBe(true);
  });

  it('writes every editable vector source', () => {
    for (const name of [
      'symbol.svg', 'symbol-dark.svg', 'symbol-mono.svg', 'wordmark.svg', 'wordmark-dark.svg',
      'logo-horizontal.svg', 'logo-horizontal-dark.svg', 'logo-horizontal-mono.svg',
      'logo-stacked.svg', 'logo-stacked-dark.svg', 'app-icon.svg', 'app-icon-maskable.svg', 'social-card.svg',
    ]) {
      expect(existsSync(join(out, 'assets', name)), name).toBe(true);
    }
  });

  it('wordmark is outlined paths, not live text', () => {
    const svg = readFileSync(join(out, 'assets', 'wordmark.svg'), 'utf8');
    expect(svg).not.toContain('<text');
    expect(svg).toContain('<path');
  });

  it('lists manifest icons including a 512 maskable entry', () => {
    expect(result.manifestIcons).toContainEqual({
      src: '/icons/maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    });
    expect(result.manifestIcons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
  });

  it('keeps the maskable symbol inside the 80% safe zone', () => {
    const size = 512;
    const { pixels } = renderSvg(appIconMaskableSvg(), size);
    const [r, g, b] = [0xc5, 0x6b, 0x4e]; // terracotta
    const ring = Math.floor(size * 0.1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x >= ring && x < size - ring && y >= ring && y < size - ring) continue;
        const i = (y * size + x) * 4;
        expect([pixels[i], pixels[i + 1], pixels[i + 2]], `pixel ${x},${y}`).toEqual([r, g, b]);
      }
    }
  });

  it('social card carries the name and tagline as outlines', () => {
    const svg = readFileSync(join(out, 'assets', 'social-card.svg'), 'utf8');
    expect(svg).toContain(`aria-label="${BRAND.name} — ${BRAND.tagline}"`);
    expect(svg).not.toContain('<text');
  });
});

describe('buildWordmark', () => {
  it('outlines every glyph at small and large sizes', async () => {
    const { buildWordmark } = await import('./build-icons');
    const count = (d: string) => (d.match(/[MLQCZ]/g) ?? []).length;
    const small = buildWordmark(48);
    const large = buildWordmark(104);
    expect(count(large.made.d)).toBe(count(small.made.d));
    expect(count(large.think.d)).toBe(count(small.think.d));
    expect(large.made.width / small.made.width).toBeCloseTo(104 / 48, 1);
  });
});
