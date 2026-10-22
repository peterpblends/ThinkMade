/**
 * Builds every ThinkMade brand asset from src/logo.ts:
 *  - editable SVG sources into packages/brand/assets
 *  - PNG icons, favicons, Apple touch icon, maskable icons and the social card into apps/web/public
 *  - manifest-icons.json for the PWA manifest
 * Run: npm run build:icons -w packages/brand
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import { BRAND } from '@thinkmade/shared';
import {
  appIconMaskableSvg,
  appIconSvg,
  appleTouchIconSvg,
  horizontalLogoSvg,
  socialCardSvg,
  stackedLogoSvg,
  symbolDarkSvg,
  symbolMonoSvg,
  symbolSvg,
  wordmarkSvg,
  type OutlinedText,
  type WordmarkParts,
} from '../src/logo';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: 'image/png';
  purpose: 'any' | 'maskable';
}

export interface BuildResult {
  files: string[];
  manifestIcons: ManifestIcon[];
}

export function renderSvg(svg: string, width: number) {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
  return { png: rendered.asPng(), pixels: rendered.pixels, width: rendered.width, height: rendered.height };
}

function loadFont(weight: 500 | 600): opentype.Font {
  const file = require.resolve(`@fontsource/newsreader/files/newsreader-latin-${weight}-normal.woff`);
  const buf = readFileSync(file);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Outlines `text` with its top at y = 0 (cap height) and returns path data and advance width. */
function outline(font: opentype.Font, text: string, size: number, x = 0): OutlinedText & { height: number } {
  const scale = size / font.unitsPerEm;
  const capHeight = ((font.tables.os2 as { sCapHeight?: number })?.sCapHeight ?? font.ascender * 0.7) * scale;
  const descent = Math.abs(font.descender) * scale;
  const path = font.getPath(text, x, capHeight, size);
  return { d: path.toPathData(2), width: font.getAdvanceWidth(text, size), height: capHeight + descent };
}

export function buildWordmark(size = 48): WordmarkParts {
  const font = loadFont(600);
  const think = outline(font, 'Think', size);
  const made = outline(font, 'Made', size, think.width);
  const scale = size / font.unitsPerEm;
  const capHeight = ((font.tables.os2 as { sCapHeight?: number })?.sCapHeight ?? font.ascender * 0.7) * scale;
  return { think, made, height: capHeight + Math.abs(font.descender) * scale * 0.35 };
}

export async function buildBrand(opts: { publicDir: string; assetsDir: string }): Promise<BuildResult> {
  const files: string[] = [];
  const write = (dir: string, name: string, data: string | Buffer) => {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    files.push(path);
  };

  const wm = buildWordmark(48);
  const medium = loadFont(500);
  const social = socialCardSvg({
    wordmark: buildWordmark(104),
    tagline: outline(medium, BRAND.tagline, 46),
    description: outline(medium, BRAND.shortDescription, 30),
  });

  const sources: Record<string, string> = {
    'symbol.svg': symbolSvg(),
    'symbol-dark.svg': symbolDarkSvg(),
    'symbol-mono.svg': symbolMonoSvg(),
    'wordmark.svg': wordmarkSvg(wm, 'light'),
    'wordmark-dark.svg': wordmarkSvg(wm, 'dark'),
    'logo-horizontal.svg': horizontalLogoSvg(wm, 'light'),
    'logo-horizontal-dark.svg': horizontalLogoSvg(wm, 'dark'),
    'logo-horizontal-mono.svg': horizontalLogoSvg(wm, 'mono'),
    'logo-stacked.svg': stackedLogoSvg(wm, 'light'),
    'logo-stacked-dark.svg': stackedLogoSvg(wm, 'dark'),
    'app-icon.svg': appIconSvg(),
    'app-icon-maskable.svg': appIconMaskableSvg(),
    'social-card.svg': social,
  };
  for (const [name, svg] of Object.entries(sources)) {
    write(opts.assetsDir, name, svg);
    if (name !== 'social-card.svg') write(opts.publicDir, `brand/${name}`, svg);
  }

  const manifestIcons: ManifestIcon[] = [];
  for (const size of [48, 72, 96, 128, 144, 192, 256, 384, 512]) {
    write(opts.publicDir, `icons/icon-${size}.png`, renderSvg(sources['app-icon.svg']!, size).png);
    manifestIcons.push({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' });
  }
  for (const size of [192, 512]) {
    write(opts.publicDir, `icons/maskable-${size}.png`, renderSvg(sources['app-icon-maskable.svg']!, size).png);
    manifestIcons.push({ src: `/icons/maskable-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' });
  }
  write(opts.publicDir, 'apple-touch-icon.png', renderSvg(appleTouchIconSvg(), 180).png);
  write(opts.publicDir, 'favicon-32.png', renderSvg(sources['app-icon.svg']!, 32).png);
  write(opts.publicDir, 'favicon-16.png', renderSvg(sources['app-icon.svg']!, 16).png);
  write(opts.publicDir, 'favicon.svg', sources['app-icon.svg']!);
  write(opts.publicDir, 'social-card.png', renderSvg(social, 1200).png);
  write(opts.publicDir, 'manifest-icons.json', JSON.stringify(manifestIcons, null, 2) + '\n');

  return { files, manifestIcons };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(here, '..', '..', '..');
  const result = await buildBrand({
    publicDir: join(root, 'apps', 'web', 'public'),
    assetsDir: join(here, '..', 'assets'),
  });
  console.info(`[brand] wrote ${result.files.length} files`);
}
