import { describe, expect, it } from 'vitest';
import { coverSvg } from './cover';

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
    const fills = new Set(Array.from({ length: 12 }, (_, i) => coverSvg({ title: 'Same title', seed: `s${i}` }).match(/stop-color="(#[0-9A-F]+)"/)![1]));
    expect(fills.size).toBeGreaterThan(2);
  });

  it('keeps a show’s colours when its title is translated', () => {
    const colour = (svg: string) => svg.match(/stop-color="(#[0-9A-F]+)"/)![1];
    expect(colour(coverSvg({ title: 'Habit Loops', seed: 's1' }))).toBe(colour(coverSvg({ title: 'Bucles de hábitos', seed: 's1' })));
  });

  it('fits long titles on at most five lines', () => {
    const svg = coverSvg({ title: 'Why Smart People Make Bad Decisions and How to Avoid Making the Same Mistakes Every Single Week of the Year Forever', seed: 'x' });
    const titleLines = svg.match(/<g fill="[^"]+" transform="translate\(110 \d+\) scale/g)!.length - 2; // minus label and subtitle
    expect(titleLines).toBeLessThanOrEqual(5);
  });

  it('escapes titles the brand font cannot draw, instead of trusting them', () => {
    const svg = coverSvg({ title: '学ぶ <script>alert(1)</script> & more', seed: 'x' });
    expect(svg).toContain('<text');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
