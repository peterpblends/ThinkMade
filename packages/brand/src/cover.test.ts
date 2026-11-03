import { describe, expect, it } from 'vitest';
import { coverLook, coverSvg, COVER_STYLES } from './cover';

describe('show artwork', () => {
  it('sets the title in outlined brand type, labelled for screen readers', () => {
    const svg = coverSvg({ title: 'Habit Loops', seed: 's1' });
    expect(svg).toMatch(/^<svg [^>]*width="1400" height="1400"/);
    expect(svg).toContain('aria-label="Habit Loops"');
    expect(svg).toContain('<title>Habit Loops</title>');
    expect(svg).not.toContain('<text'); // every character has a brand glyph
  });

  it('is the same for the same show and varies between shows', () => {
    expect(coverSvg({ title: 'Habit Loops', seed: 's1' })).toBe(coverSvg({ title: 'Habit Loops', seed: 's1' }));
    const looks = Array.from({ length: 40 }, (_, i) => coverLook(`s${i}`));
    expect(new Set(looks.map((l) => l.style)).size).toBeGreaterThan(6);
    expect(new Set(looks.map((l) => l.palette)).size).toBeGreaterThan(8);
  });

  it('draws every art style as well-formed SVG', () => {
    const seen = new Set<string>();
    for (let i = 0; seen.size < COVER_STYLES.length && i < 500; i++) {
      const { style } = coverLook(`seed${i}`);
      if (seen.has(style)) continue;
      seen.add(style);
      const svg = coverSvg({ title: 'Habit Loops', seed: `seed${i}` });
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg.match(/<svg/g)).toHaveLength(1);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
    expect(seen.size).toBe(COVER_STYLES.length);
  });

  it('keeps a show’s art when its title is translated', () => {
    const art = (svg: string) => svg.slice(0, svg.indexOf('<linearGradient id="scrim"')).replace(/<title>.*<\/title>/, '').replace(/aria-label="[^"]*"/, '');
    expect(art(coverSvg({ title: 'Habit Loops', seed: 's1' }))).toBe(art(coverSvg({ title: 'Bucles de hábitos', seed: 's1' })));
  });

  it('fits long titles on at most five lines', () => {
    const svg = coverSvg({ title: 'Why Smart People Make Bad Decisions and How to Avoid Making the Same Mistakes Every Single Week of the Year Forever', seed: 'x' });
    const titleLines = svg.match(/<g fill="[^"]+" transform="translate\(110 \d+\) scale/g)!.length - 1; // minus the subtitle
    expect(titleLines).toBeLessThanOrEqual(5);
  });

  it('escapes titles the brand font cannot draw, instead of trusting them', () => {
    const svg = coverSvg({ title: '学ぶ <script>alert(1)</script> & more', seed: 'x' });
    expect(svg).toContain('<text');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
