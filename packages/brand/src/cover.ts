/**
 * Show artwork: a square podcast cover, like the shows in a podcast app: bold generative art (one of several
 * styles: orbits, auras, Bauhaus tiles, waveforms, sunrises, contour lines, halftones, ribbons, arches, collage)
 * in one of the palettes, with the show's title set large in the brand typeface (outlined, so it looks the same
 * everywhere). Everything comes from a seed, so a show looks the same in every language, and a new seed gives
 * new art.
 */
import { BRAND } from '@thinkmade/shared';
import { COVER_FONT_CAP_HEIGHT, COVER_FONT_UNITS, COVER_GLYPHS } from './cover-glyphs';

type Palette = { name: string; bg: string; text: string; sub: string; c: [string, string, string, string]; dark: boolean };

const PALETTES: Palette[] = [
  { name: 'midnight', bg: '#14213D', text: '#F7F4EE', sub: '#C9D3E6', c: ['#FCA311', '#E85D75', '#4EA8DE', '#F7F4EE'], dark: true },
  { name: 'ember', bg: '#1B1B1E', text: '#F5F0E6', sub: '#CFC6B8', c: ['#FF6B35', '#F7C59F', '#2EC4B6', '#EFEFD0'], dark: true },
  { name: 'ivory', bg: '#F4EDE1', text: '#1F1A17', sub: '#5F5A53', c: ['#C56B4E', '#2D4B73', '#E2B23A', '#7A9E7E'], dark: false },
  { name: 'lagoon', bg: '#0F3D3E', text: '#F2EFE6', sub: '#C6D8D3', c: ['#E2C275', '#F28C6A', '#7FC8A9', '#F2EFE6'], dark: true },
  { name: 'volt', bg: '#3A0CA3', text: '#FFFFFF', sub: '#DCCFFF', c: ['#F72585', '#4CC9F0', '#FFD166', '#B5179E'], dark: true },
  { name: 'sunshine', bg: '#FFD23F', text: '#1A1A1A', sub: '#4A3F1A', c: ['#EE4266', '#3BCEAC', '#540D6E', '#FFFFFF'], dark: false },
  { name: 'signal', bg: '#E63946', text: '#FFF8F0', sub: '#FFE1DE', c: ['#1D3557', '#F1FAEE', '#FFB703', '#A8DADC'], dark: true },
  { name: 'desert', bg: '#264653', text: '#F8F4E3', sub: '#CFE0DF', c: ['#E9C46A', '#F4A261', '#E76F51', '#2A9D8F'], dark: true },
  { name: 'blush', bg: '#FBE7E0', text: '#2B1B17', sub: '#6B4A43', c: ['#FF5D73', '#7C3AED', '#FFB4A2', '#22223B'], dark: false },
  { name: 'deep sea', bg: '#0B132B', text: '#E0FBFC', sub: '#B4CBD6', c: ['#5BC0BE', '#3A506B', '#FFC857', '#E0FBFC'], dark: true },
  { name: 'forest', bg: '#2D6A4F', text: '#F1FAEE', sub: '#D8F3DC', c: ['#95D5B2', '#FFD6A5', '#D8F3DC', '#1B4332'], dark: true },
  { name: 'tangerine', bg: '#FF8C42', text: '#1F1300', sub: '#4D2C10', c: ['#FFF3B0', '#2E294E', '#D7263D', '#FFFFFF'], dark: false },
  { name: 'sky', bg: '#E9F1F7', text: '#0D1B2A', sub: '#3E4C5E', c: ['#1B98E0', '#FF6B6B', '#13315C', '#F9C80E'], dark: false },
  { name: 'plum', bg: '#432838', text: '#F7F4EE', sub: '#E8D5DE', c: ['#E39A7E', '#F2C14E', '#8DB1AB', '#F7F4EE'], dark: true },
];

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

/** A small, fast random generator, so the same seed always draws the same art. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const f = (n: number) => Math.round(n * 10) / 10;

/** Fine film grain over the art, as printed covers have. */
const grain = (id: string, opacity: number) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${opacity} 0"/></filter>` +
  `<rect width="${COVER_SIZE}" height="${COVER_SIZE}" filter="url(#${id})"/>`;

/** Each style draws art over the palette's background. The title sits over the lower part, on a soft scrim. */
const STYLES: Record<string, (r: Rand, p: Palette, S: number) => string> = {
  // Eccentric rings, like a record or a ripple of sound.
  orbits(r, p, S) {
    const cx = S * between(r, 0.45, 0.75);
    const cy = S * between(r, 0.25, 0.4);
    const n = 6 + Math.floor(r() * 4);
    const R = S * between(r, 0.42, 0.55);
    const dx = between(r, -18, 18);
    const dy = between(r, -12, 12);
    const order = [...p.c, p.bg];
    let out = '';
    for (let k = n; k >= 1; k--) out += `<circle cx="${f(cx + dx * (n - k))}" cy="${f(cy + dy * (n - k))}" r="${f((R * k) / n)}" fill="${order[(k + n) % order.length]}"/>`;
    return out;
  },
  // Soft blurred colour fields with grain.
  aura(r, p, S) {
    let blobs = '';
    // Strong colours only: a pale colour washes the aura out.
    const strong = p.c.filter((c) => c.toUpperCase() !== '#FFFFFF' && c !== p.text);
    for (let i = 0; i < 5; i++) blobs += `<circle cx="${f(S * between(r, 0.05, 0.95))}" cy="${f(S * between(r, 0, 0.6))}" r="${f(S * between(r, 0.26, 0.4))}" fill="${strong[i % strong.length]}"/>`;
    return `<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(S * 0.06)}"/></filter><g filter="url(#blur)">${blobs}</g>` + grain('grain', 0.16);
  },
  // A grid of tiles with quarter circles, half circles and triangles.
  bauhaus(r, p, S) {
    const n = pick(r, [3, 4]);
    const t = S / n;
    const rows = n === 3 ? 2 : 3;
    const cols = [...p.c, p.bg];
    let out = '';
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < n; x++) {
        const X = x * t;
        const Y = y * t;
        const bg = pick(r, cols);
        const fg = pick(r, cols.filter((c) => c !== bg));
        out += `<rect x="${f(X)}" y="${f(Y)}" width="${f(t)}" height="${f(t)}" fill="${bg}"/>`;
        const kind = Math.floor(r() * 5);
        const corner = Math.floor(r() * 4);
        const cxs = [X, X + t, X + t, X];
        const cys = [Y, Y, Y + t, Y + t];
        if (kind === 0) out += `<path d="M${f(cxs[corner]!)} ${f(cys[corner]!)} L${f(cxs[(corner + 1) % 4]!)} ${f(cys[(corner + 1) % 4]!)} A${f(t)} ${f(t)} 0 0 1 ${f(cxs[(corner + 3) % 4]!)} ${f(cys[(corner + 3) % 4]!)} Z" fill="${fg}"/>`;
        else if (kind === 1) out += `<circle cx="${f(X + t / 2)}" cy="${f(Y + t / 2)}" r="${f(t * 0.36)}" fill="${fg}"/>`;
        else if (kind === 2) out += `<path d="M${f(X)} ${f(Y + t / 2)} A${f(t / 2)} ${f(t / 2)} 0 0 ${corner % 2} ${f(X + t)} ${f(Y + t / 2)} Z" fill="${fg}"/>`;
        else if (kind === 3) out += `<path d="M${f(cxs[corner]!)} ${f(cys[corner]!)} L${f(cxs[(corner + 1) % 4]!)} ${f(cys[(corner + 1) % 4]!)} L${f(cxs[(corner + 3) % 4]!)} ${f(cys[(corner + 3) % 4]!)} Z" fill="${fg}"/>`;
        else for (let k = 0; k < 4; k++) out += `<rect x="${f(X)}" y="${f(Y + (k * t) / 4 + t / 16)}" width="${f(t)}" height="${f(t / 8)}" fill="${fg}"/>`;
      }
    return `<clipPath id="tiles"><rect width="${S}" height="${f((rows * S) / n)}"/></clipPath><g clip-path="url(#tiles)">${out}</g>`;
  },
  // An audio waveform across the cover.
  waveform(r, p, S) {
    const n = 34 + Math.floor(r() * 14);
    const gap = S / n;
    const w = gap * between(r, 0.45, 0.62);
    const mid = S * between(r, 0.3, 0.4);
    const ph = [r() * 6, r() * 6, r() * 6];
    const [a, b] = [p.c[0], p.c[1]];
    let bars = '';
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const amp = Math.abs(Math.sin(x * 7 + ph[0]!) * 0.5 + Math.sin(x * 17 + ph[1]!) * 0.3 + Math.sin(x * 31 + ph[2]!) * 0.2) * 0.85 + 0.08 + r() * 0.1;
      const h = S * 0.5 * amp;
      bars += `<rect x="${f(i * gap + (gap - w) / 2)}" y="${f(mid - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(w / 2)}" fill="url(#wave)"/>`;
    }
    return `<linearGradient id="wave" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>${bars}`;
  },
  // A striped sun rising over layered hills.
  sunrise(r, p, S) {
    const cx = S * between(r, 0.35, 0.65);
    const cy = S * between(r, 0.3, 0.36);
    const R = S * between(r, 0.24, 0.3);
    let stripes = '';
    for (let k = 0; k < 6; k++) {
      const y = cy + (k * R) / 6;
      stripes += `<rect x="${f(cx - R)}" y="${f(y)}" width="${f(2 * R)}" height="${f(10 + k * 9)}" fill="${p.bg}"/>`;
    }
    const hill = (base: number, amp: number, color: string) => {
      const ph = r() * 6;
      let d = `M0 ${S}`;
      for (let i = 0; i <= 20; i++) d += ` L${f((i / 20) * S)} ${f(base + Math.sin((i / 20) * 5 + ph) * amp)}`;
      return `<path d="${d} L${S} ${S} Z" fill="${color}"/>`;
    };
    return (
      `<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.c[0]}"/><stop offset="1" stop-color="${p.c[2]}"/></linearGradient>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="url(#sun)"/>${stripes}` +
      hill(S * 0.48, S * 0.03, p.c[1]) +
      hill(S * 0.55, S * 0.035, p.c[3]) +
      grain('grain', 0.1)
    );
  },
  // Topographic contour lines.
  contours(r, p, S) {
    const cx = S * between(r, 0.3, 0.7);
    const cy = S * between(r, 0.25, 0.42);
    const n = 13 + Math.floor(r() * 6);
    const waves = [1 + Math.floor(r() * 3), 3 + Math.floor(r() * 3)];
    const ph = [r() * 6, r() * 6];
    let out = '';
    for (let k = 1; k <= n; k++) {
      const base = (k / n) * S * 0.72;
      let d = '';
      for (let i = 0; i <= 72; i++) {
        const th = (i / 72) * Math.PI * 2;
        const rr = base * (1 + 0.12 * Math.sin(th * waves[0]! + ph[0]! + k * 0.15) + 0.05 * Math.sin(th * waves[1]! + ph[1]!));
        d += `${i ? 'L' : 'M'}${f(cx + Math.cos(th) * rr)} ${f(cy + Math.sin(th) * rr)}`;
      }
      out += `<path d="${d}Z" fill="none" stroke="${k % 4 === 0 ? p.c[0] : p.c[k % 2 ? 3 : 2]}" stroke-width="${k % 4 === 0 ? 12 : 6}" stroke-opacity="${k % 4 === 0 ? 1 : 0.75}"/>`;
    }
    return out;
  },
  // A halftone of dots that grow towards a focal point.
  halftone(r, p, S) {
    const fx = S * between(r, 0.4, 0.8);
    const fy = S * between(r, 0.2, 0.4);
    const step = 52;
    const big = `<circle cx="${f(fx)}" cy="${f(fy)}" r="${f(S * between(r, 0.2, 0.28))}" fill="${p.c[1]}"/>`;
    let dots = '';
    for (let y = step / 2; y < S * 0.78; y += step)
      for (let x = step / 2; x < S; x += step) {
        const d = Math.hypot(x - fx, y - fy) / (S * 0.75);
        const rad = (step / 2) * Math.max(0, 0.95 - d);
        if (rad > 2) dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}"/>`;
      }
    return `${big}<g fill="${p.c[0]}">${dots}</g>`;
  },
  // Thick flowing ribbons.
  ribbons(r, p, S) {
    let out = '';
    const n = 5 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const y0 = S * between(r, -0.05, 0.7);
      const y1 = S * between(r, -0.05, 0.7);
      out += `<path d="M${f(-S * 0.1)} ${f(y0)} C${f(S * 0.3)} ${f(y0 + between(r, -400, 400))} ${f(S * 0.7)} ${f(y1 + between(r, -400, 400))} ${f(S * 1.1)} ${f(y1)}" fill="none" stroke="${p.c[i % 4]}" stroke-width="${f(between(r, 70, 150))}" stroke-linecap="round"/>`;
    }
    return out;
  },
  // Stacked mid-century arches.
  arches(r, p, S) {
    const cx = S * between(r, 0.3, 0.7);
    const base = S * between(r, 0.6, 0.66);
    const n = 5 + Math.floor(r() * 3);
    const R = S * between(r, 0.4, 0.5);
    let out = `<circle cx="${f(S * between(r, 0.15, 0.85))}" cy="${f(S * between(r, 0.1, 0.2))}" r="${f(S * 0.07)}" fill="${p.c[0]}"/>`;
    for (let k = 0; k < n; k++) {
      const rr = R * (1 - k / (n + 1));
      out += `<path d="M${f(cx - rr)} ${f(base)} A${f(rr)} ${f(rr)} 0 0 1 ${f(cx + rr)} ${f(base)} Z" fill="${k === n - 1 ? p.bg : p.c[(k + 1) % 4]}"/>`;
    }
    return out;
  },
  // A collage of large overlapping shapes.
  collage(r, p, S) {
    let out = '';
    for (let i = 0; i < 9; i++) {
      const x = S * between(r, 0, 1);
      const y = S * between(r, 0, 0.6);
      const size = S * between(r, 0.25, 0.45);
      const color = p.c[i % 4];
      const rot = between(r, -40, 40);
      const kind = Math.floor(r() * 3);
      const shape =
        kind === 0
          ? `<circle cx="0" cy="0" r="${f(size / 2)}"/>`
          : kind === 1
            ? `<rect x="${f(-size / 2)}" y="${f(-size / 2)}" width="${f(size)}" height="${f(size)}" rx="${f(size * 0.08)}"/>`
            : `<path d="M0 ${f(-size / 2)} L${f(size / 2)} ${f(size / 2)} L${f(-size / 2)} ${f(size / 2)} Z"/>`;
      out += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" fill="${color}" fill-opacity="0.92">${shape}</g>`;
    }
    return out + grain('grain', 0.08);
  },
};

export const COVER_STYLES = Object.keys(STYLES);

/** The art style and palette a seed draws, so a regenerated cover can be made to look different. */
export function coverLook(seed: string): { style: string; palette: string } {
  const h = hash(seed);
  return { style: COVER_STYLES[h % COVER_STYLES.length]!, palette: PALETTES[(h >>> 8) % PALETTES.length]!.name };
}

export interface CoverOptions {
  title: string;
  /** Picks the art and palette (the series id, or a regenerated cover's seed), so a show looks the same whatever its title's language. */
  seed?: string;
  /** Line under the title. */
  subtitle?: string;
}

/** A 1400 × 1400 SVG cover for a podcast show. */
export function coverSvg({ title, seed = '', subtitle = `A ${BRAND.name} podcast` }: CoverOptions): string {
  const S = COVER_SIZE;
  // A show keeps its look in every language: with a seed (the series id) the title doesn't change it.
  const key = seed || title;
  const h = hash(key);
  const look = coverLook(key);
  const p = PALETTES.find((x) => x.name === look.palette)!;
  const text = typeset(title) || BRAND.name;
  const width = S - MARGIN * 2;

  // The largest size (up to 168 px) at which the title fits in four lines.
  let size = 168;
  let lines = wrap(text, (width / size) * COVER_FONT_UNITS);
  while (size > 72 && lines.length > 4) {
    size -= 6;
    lines = wrap(text, (width / size) * COVER_FONT_UNITS);
  }
  if (lines.length > 5) lines = [...lines.slice(0, 4), `${lines[4]!.replace(/[\s,.;:–-]+$/, '')}…`];
  const lineHeight = size * 1.04;
  const subSize = 44;
  const subY = S - MARGIN + 10;
  const lastBaseline = subY - subSize - 60;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;
  const titleTop = firstBaseline - size;

  const art = STYLES[look.style]!(rng(h), p, S);
  // A scrim in the background colour behind the title, so it reads over any art.
  const scrimTop = Math.max(0, titleTop - 300);
  const scrim =
    `<linearGradient id="scrim" x1="0" y1="${scrimTop}" x2="0" y2="${S}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.bg}" stop-opacity="0"/><stop offset="${f(Math.min(0.95, 280 / (S - scrimTop)))}" stop-color="${p.bg}" stop-opacity="0.94"/><stop offset="1" stop-color="${p.bg}"/></linearGradient>` +
    `<rect y="${scrimTop}" width="${S}" height="${S - scrimTop}" fill="url(#scrim)"/>`;

  const accent = `<rect x="${MARGIN}" y="${f(titleTop - 56)}" width="110" height="10" rx="5" fill="${p.c[0] === p.bg ? p.c[1] : p.c[0]}"/>`;
  const titleLines = lines.map((l, i) => textLine(l, MARGIN, Math.round(firstBaseline + i * lineHeight), size, p.text)).join('');
  const sub = textLine(subtitle.toUpperCase(), MARGIN, subY, subSize * 0.8, p.sub, 500);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${escapeXml(text)}">` +
    `<title>${escapeXml(text)}</title>` +
    `<rect width="${S}" height="${S}" fill="${p.bg}"/>` +
    art +
    scrim +
    accent +
    titleLines +
    sub +
    `</svg>`
  );
}

/** Height of a capital at `size` pixels, for layouts that align to the title. */
export const coverCapHeight = (size: number) => (COVER_FONT_CAP_HEIGHT / COVER_FONT_UNITS) * size;
