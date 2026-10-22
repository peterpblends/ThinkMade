/**
 * ThinkMade symbol: the "thinking fingerprint".
 * Two offset ridges circle a terracotta core: ideas gathering around one insight.
 * The gaps sit on opposite sides so the ridges read as a personal print and as a path inward.
 * Geometry is defined on a 64 x 64 grid. Everything here is pure and returns SVG markup.
 */
import { BRAND } from '@thinkmade/shared';

export const COLORS = {
  ivory: BRAND.colors.warmIvory,
  charcoal: BRAND.colors.deepCharcoal,
  terracotta: BRAND.colors.terracotta,
  sage: BRAND.colors.sageGreen,
  white: BRAND.colors.softWhite,
  night: '#1C1A18',
} as const;

const GRID = 64;
const CENTER = 32;
const STROKE = 5;
const CORE_RADIUS = 5;
/** [radius, startAngle, endAngle] in degrees, clockwise from 3 o'clock. */
const RIDGES: ReadonlyArray<readonly [number, number, number]> = [
  [11, -60, 200],
  [22, 120, 380],
];

function arc(r: number, a0: number, a1: number): string {
  const rad = (a: number) => (a * Math.PI) / 180;
  const p = (a: number) => [CENTER + r * Math.cos(rad(a)), CENTER + r * Math.sin(rad(a))].map((n) => n.toFixed(2));
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = (((a1 - a0) % 360) + 360) % 360 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export interface SymbolColors {
  ridge: string;
  core: string;
}

/** The symbol as an SVG group on the 64-unit grid. */
export function symbolGroup(colors: SymbolColors, transform = ''): string {
  const d = RIDGES.map(([r, a0, a1]) => arc(r, a0, a1)).join(' ');
  const t = transform ? ` transform="${transform}"` : '';
  return (
    `<g${t}><path d="${d}" fill="none" stroke="${colors.ridge}" stroke-width="${STROKE}" stroke-linecap="round"/>` +
    `<circle cx="${CENTER}" cy="${CENTER}" r="${CORE_RADIUS}" fill="${colors.core}"/></g>`
  );
}

function svg(width: number, height: number, body: string, label: string = BRAND.name): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}">${body}</svg>\n`;
}

export const symbolSvg = () => svg(GRID, GRID, symbolGroup({ ridge: COLORS.charcoal, core: COLORS.terracotta }));
export const symbolDarkSvg = () => svg(GRID, GRID, symbolGroup({ ridge: COLORS.ivory, core: COLORS.terracotta }));
export const symbolMonoSvg = () => svg(GRID, GRID, symbolGroup({ ridge: COLORS.charcoal, core: COLORS.charcoal }));

/** Rounded-square app icon: ivory symbol on terracotta. Used for "any" purpose icons and favicons. */
export function appIconSvg(): string {
  const scale = 0.78;
  const offset = (GRID - GRID * scale) / 2;
  return svg(
    GRID,
    GRID,
    `<rect width="${GRID}" height="${GRID}" rx="14" fill="${COLORS.terracotta}"/>` +
      symbolGroup({ ridge: COLORS.ivory, core: COLORS.ivory }, `translate(${offset} ${offset}) scale(${scale})`),
  );
}

/** Full-bleed square for iOS (which applies its own mask). */
export function appleTouchIconSvg(): string {
  const scale = 0.72;
  const offset = (GRID - GRID * scale) / 2;
  return svg(
    GRID,
    GRID,
    `<rect width="${GRID}" height="${GRID}" fill="${COLORS.terracotta}"/>` +
      symbolGroup({ ridge: COLORS.ivory, core: COLORS.ivory }, `translate(${offset} ${offset}) scale(${scale})`),
  );
}

/** Maskable icon: full-bleed background, symbol kept inside the central 80% safe zone. */
export function appIconMaskableSvg(): string {
  const scale = 0.6;
  const offset = (GRID - GRID * scale) / 2;
  return svg(
    GRID,
    GRID,
    `<rect width="${GRID}" height="${GRID}" fill="${COLORS.terracotta}"/>` +
      symbolGroup({ ridge: COLORS.ivory, core: COLORS.ivory }, `translate(${offset} ${offset}) scale(${scale})`),
  );
}

/** Outlined text produced by the build script from the brand typeface. */
export interface OutlinedText {
  d: string;
  width: number;
}

export interface WordmarkParts {
  think: OutlinedText;
  made: OutlinedText;
  /** Font units already converted: cap height and baseline in the same coordinate space as the paths. */
  height: number;
}

export type Tone = 'light' | 'dark' | 'mono';

function toneColors(tone: Tone) {
  if (tone === 'dark') return { text: COLORS.ivory, accent: COLORS.terracotta, ridge: COLORS.ivory, core: COLORS.terracotta };
  if (tone === 'mono') return { text: COLORS.charcoal, accent: COLORS.charcoal, ridge: COLORS.charcoal, core: COLORS.charcoal };
  return { text: COLORS.charcoal, accent: COLORS.terracotta, ridge: COLORS.charcoal, core: COLORS.terracotta };
}

function wordmarkGroup(w: WordmarkParts, tone: Tone, transform = ''): string {
  const c = toneColors(tone);
  const t = transform ? ` transform="${transform}"` : '';
  return `<g${t}><path d="${w.think.d}" fill="${c.text}"/><path d="${w.made.d}" fill="${c.accent}"/></g>`;
}

export function wordmarkSvg(w: WordmarkParts, tone: Tone = 'light'): string {
  const width = Math.ceil(w.think.width + w.made.width);
  return svg(width, Math.ceil(w.height), wordmarkGroup(w, tone));
}

export function horizontalLogoSvg(w: WordmarkParts, tone: Tone = 'light'): string {
  const c = toneColors(tone);
  const symbolSize = w.height * 1.25;
  const gap = symbolSize * 0.28;
  const width = Math.ceil(symbolSize + gap + w.think.width + w.made.width);
  const height = Math.ceil(symbolSize);
  const textY = (symbolSize - w.height) / 2;
  return svg(
    width,
    height,
    symbolGroup({ ridge: c.ridge, core: c.core }, `scale(${symbolSize / GRID})`) +
      wordmarkGroup(w, tone, `translate(${symbolSize + gap} ${textY})`),
  );
}

export function stackedLogoSvg(w: WordmarkParts, tone: Tone = 'light'): string {
  const c = toneColors(tone);
  const textWidth = w.think.width + w.made.width;
  const symbolSize = w.height * 2.2;
  const gap = w.height * 0.45;
  const width = Math.ceil(Math.max(textWidth, symbolSize));
  const height = Math.ceil(symbolSize + gap + w.height);
  return svg(
    width,
    height,
    symbolGroup({ ridge: c.ridge, core: c.core }, `translate(${(width - symbolSize) / 2} 0) scale(${symbolSize / GRID})`) +
      wordmarkGroup(w, tone, `translate(${(width - textWidth) / 2} ${symbolSize + gap})`),
  );
}

export interface SocialCardText {
  wordmark: WordmarkParts;
  tagline: OutlinedText & { height: number };
  description: OutlinedText & { height: number };
}

/** 1200 x 630 Open Graph image. All text is outlined so it renders identically everywhere. */
export function socialCardSvg(t: SocialCardText): string {
  const W = 1200;
  const H = 630;
  const symbolSize = 300;
  const left = 110;
  const textX = left + symbolSize + 80;
  const wmScale = 1;
  const top = (H - (t.wordmark.height + 36 + t.tagline.height + 22 + t.description.height)) / 2;
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="${COLORS.ivory}"/>` +
      `<rect x="0" y="${H - 14}" width="${W}" height="14" fill="${COLORS.terracotta}"/>` +
      symbolGroup({ ridge: COLORS.charcoal, core: COLORS.terracotta }, `translate(${left} ${(H - symbolSize) / 2}) scale(${symbolSize / GRID})`) +
      wordmarkGroup(t.wordmark, 'light', `translate(${textX} ${top}) scale(${wmScale})`) +
      `<path d="${t.tagline.d}" fill="${COLORS.charcoal}" transform="translate(${textX} ${top + t.wordmark.height + 36})"/>` +
      `<path d="${t.description.d}" fill="${COLORS.sage}" transform="translate(${textX} ${top + t.wordmark.height + 36 + t.tagline.height + 22})"/>`,
    `${BRAND.name} — ${BRAND.tagline}`,
  );
}
