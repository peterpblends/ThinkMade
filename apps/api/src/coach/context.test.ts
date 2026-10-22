import { describe, expect, it } from 'vitest';
import { selectExcerpts } from './context';

describe('selectExcerpts', () => {
  it('returns a short transcript whole', () => {
    expect(selectExcerpts('one two three', 'x')).toEqual(['one two three']);
  });
  it('picks the chunks that mention the question, in transcript order, within budget', () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `filler${i}`).join(' ');
    const t = `${filler(500)} hiring decisions matter because hiring shapes teams ${filler(500)} budgets and hiring again ${filler(500)}`;
    const ex = selectExcerpts(t, 'How does this apply to hiring?', 440, 220);
    expect(ex.length).toBeLessThanOrEqual(2);
    expect(ex.join(' ')).toContain('hiring');
    expect(ex.join(' ').split(' ').length).toBeLessThanOrEqual(440);
  });
});
