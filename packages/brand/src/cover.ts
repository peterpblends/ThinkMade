/**
 * Show artwork: a square podcast cover with the show's title set in the brand typeface (outlined, so it looks
 * the same everywhere), over one of the brand palettes and a large crop of the ThinkMade symbol. Each show gets
 * its own palette and symbol angle from its title, so covers in a library differ while looking like a family.
 */
import { BRAND } from '@thinkmade/shared';
import { COVER_FONT_CAP_HEIGHT, COVER_FONT_UNITS, COVER_GLYPHS } from './cover-glyphs';
import { SYMBOL_GEOMETRY } from './logo';

const PALETTES = [
  { name: 'terracotta', from: '#C56B4E', to: '#8E3F28', text: '#F7F4EE', sub: '#F2DCD2', ridge: '#F7F4EE', ridgeOpacity: 0.22, core: '#F7F4EE' },
  { name: 'charcoal', from: '#33302C', to: '#1C1A18', text: '#F7F4EE', sub: '#C9C0B3', ridge: '#F7F4EE', ridgeOpacity: 0.16, core: '#C56B4E' },
  { name: 'sage', from: '#829284', to: '#4E5E51', text: '#F7F4EE', sub: '#E1E8E1', ridge: '#F7F4EE', ridgeOpacity: 0.2, core: '#C56B4E' },
  { name: 'ivory', from: '#F7F4EE', to: '#E9E0D1', text: '#292929', sub: '#5F5A53', ridge: '#292929', ridgeOpacity: 0.1, core: '#C56B4E' },
  { name: 'ink', from: '#33475A', to: '#1D2A36', text: '#F7F4EE', sub: '#C9D3DC', ridge: '#F7F4EE', ridgeOpacity: 0.16, core: '#D98466' },
  { name: 'plum', from: '#6E4559', to: '#432838', text: '#F7F4EE', sub: '#E8D5DE', ridge: '#F7F4EE', ridgeOpacity: 0.18, core: '#E39A7E' },
] as const;

export const COVER_SIZE = 1400;
const MARGIN = 110;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Typographic quotes and dashes, as the brand sets titles. */
function typeset(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s([{])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s([{])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/ - /g, ' – ');
}

const canOutline = (s: string) => [...s].every((ch) => ch in COVER_GLYPHS);
/** Width of `s` in font units (outlined glyphs, or an estimate for text the brand font lacks). */
const measure = (s: string) => [...s].reduce((w, ch) => w + (COVER_GLYPHS[ch]?.[0] ?? COVER_FONT_UNITS * 0.55), 0);

/** Breaks the title into lines no wider than `maxUnits`, breaking inside a word only when a single word is too long. */
function wrap(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxUnits) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line) > maxUnits) {
      let cut = line.length - 1;
      while (cut > 1 && measure(`${line.slice(0, cut)}-`) > maxUnits) cut--;
      lines.push(`${line.slice(0, cut)}-`);
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The glyphs of `s` as one path, scaled to `size` pixels, with the baseline at (x, y). */
function outlined(s: string, x: number, y: number, size: number, fill: string): string {
  let pen = 0;
  const parts: string[] = [];
  for (const ch of s) {
    const [advance, d] = COVER_GLYPHS[ch]!;
    if (d) parts.push(`<path transform="translate(${pen} 0)" d="${d}"/>`);
    pen += advance;
  }
  return `<g fill="${fill}" transform="translate(${x} ${y}) scale(${(size / COVER_FONT_UNITS).toFixed(5)})">${parts.join('')}</g>`;
}

function textLine(s: string, x: number, y: number, size: number, fill: string, weight = 600): string {
  if (canOutline(s)) return outlined(s, x, y, size, fill);
  return `<text x="${x}" y="${y}" font-family="Newsreader, Georgia, 'Times New Roman', serif" font-weight="${weight}" font-size="${size}" fill="${fill}">${escapeXml(s)}</text>`;
}

export interface CoverOptions {
  title: string;
  /** Picks the palette and symbol angle (the series id), so a show looks the same whatever its title's language. */
  seed?: string;
  /** Line under the title. */
  subtitle?: string;
}

/** A 1400 × 1400 SVG cover for a podcast show. */
export function coverSvg({ title, seed = '', subtitle = `A ${BRAND.name} podcast` }: CoverOptions): string {
  const S = COVER_SIZE;
  // A show keeps its look in every language: with a seed (the series id) the title doesn't change it.
  const h = hash(seed || title);
  const p = PALETTES[h % PALETTES.length]!;
  const text = typeset(title) || BRAND.name;
  const width = S - MARGIN * 2;

  // The largest size (up to 150 px) at which the title fits in four lines.
  let size = 150;
  let lines = wrap(text, (width / size) * COVER_FONT_UNITS);
  while (size > 72 && lines.length > 4) {
    size -= 6;
    lines = wrap(text, (width / size) * COVER_FONT_UNITS);
  }
  if (lines.length > 5) lines = [...lines.slice(0, 4), `${lines[4]!.replace(/[\s,.;:–-]+$/, '')}…`];
  const lineHeight = size * 1.08;
  const subSize = 44;
  const bottom = S - MARGIN;
  const subY = bottom;
  const lastBaseline = subY - subSize - 72;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;

  // A large crop of the symbol, top right, at an angle that varies by show.
  const g = SYMBOL_GEOMETRY;
  const symbolScale = 1150 / 64;
  const angle = ((h >>> 8) % 360) - 180;
  const sx = S - 420 + ((h >>> 16) % 120);
  const sy = 330 - ((h >>> 20) % 140);
  const symbol =
    `<g transform="translate(${sx} ${sy}) rotate(${angle}) scale(${symbolScale.toFixed(3)}) translate(${-g.center} ${-g.center})">` +
    `<path d="${g.ridgePath}" fill="none" stroke="${p.ridge}" stroke-opacity="${p.ridgeOpacity}" stroke-width="${g.strokeWidth}" stroke-linecap="round"/>` +
    `<circle cx="${g.center}" cy="${g.center}" r="${g.coreRadius}" fill="${p.core}" fill-opacity="0.9"/></g>`;

  const label = textLine(BRAND.name.toUpperCase(), MARGIN, MARGIN + 34, 40, p.text);
  const rule = `<rect x="${MARGIN}" y="${MARGIN + 62}" width="120" height="6" rx="3" fill="${p.core}"/>`;
  const titleLines = lines.map((l, i) => textLine(l, MARGIN, Math.round(firstBaseline + i * lineHeight), size, p.text)).join('');
  const sub = textLine(subtitle, MARGIN, subY, subSize, p.sub, 500);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${escapeXml(text)}">` +
    `<title>${escapeXml(text)}</title>` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs>` +
    `<rect width="${S}" height="${S}" fill="url(#bg)"/>` +
    symbol +
    label +
    rule +
    titleLines +
    sub +
    `</svg>`
  );
}

/** Height of a capital at `size` pixels, for layouts that align to the title. */
export const coverCapHeight = (size: number) => (COVER_FONT_CAP_HEIGHT / COVER_FONT_UNITS) * size;
