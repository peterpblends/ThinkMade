import { describe, expect, it } from 'vitest';
import { aggregateJudgements, judgeWindows, scriptChecks } from './quality';

const seg = (text: string, speaker: 'A' | 'B' | 'C' = 'A') => ({ speaker, text });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';

describe('scriptChecks', () => {
  it('passes a script of the right length with no problems', () => {
    expect(scriptChecks([[seg(words(140))]], { targetWords: 150, format: 'single' })).toEqual([]);
  });

  it('flags a script far shorter than the target length', () => {
    expect(scriptChecks([[seg(words(60))]], { targetWords: 150, format: 'single' })).toContainEqual(expect.objectContaining({ code: 'too_short', section: null }));
  });

  it('flags a script far longer than the target length', () => {
    expect(scriptChecks([[seg(words(260))]], { targetWords: 150, format: 'single' })).toContainEqual(expect.objectContaining({ code: 'too_long' }));
  });

  it('flags Thinking/Seeing/Doing announced as labels', () => {
    const problems = scriptChecks([[seg(`Seeing: here is how to spot it. ${words(140)}`)]], { targetWords: 150, format: 'single' });
    expect(problems).toContainEqual(expect.objectContaining({ code: 'announced_labels', section: 1 }));
  });

  it('flags a two-host episode where one host never speaks', () => {
    expect(scriptChecks([[seg(words(150), 'A')]], { targetWords: 150, format: 'two_hosts' })).toContainEqual(expect.objectContaining({ code: 'one_sided' }));
  });

  it('flags a three-host episode where one host barely speaks, and passes a balanced one', () => {
    const lopsided = [[seg(words(80), 'A'), seg(words(66), 'B'), seg(words(4), 'C')]];
    expect(scriptChecks(lopsided, { targetWords: 150, format: 'group', hostIds: ['A', 'B', 'C'] })).toContainEqual(expect.objectContaining({ code: 'one_sided', message: expect.stringContaining('host C') }));
    const balanced = [[seg(words(50), 'A'), seg(words(50), 'B'), seg(words(50), 'C')]];
    expect(scriptChecks(balanced, { targetWords: 150, format: 'group', hostIds: ['A', 'B', 'C'] })).toEqual([]);
  });

  it('flags heavy repetition of the same sentence', () => {
    const repeated = Array.from({ length: 12 }, () => 'The key idea is to name the alternative you give up.').join(' ');
    expect(scriptChecks([[seg(repeated)]], { targetWords: 120, format: 'single' })).toContainEqual(expect.objectContaining({ code: 'repetition' }));
  });

  it('flags markdown and stage directions that would be read aloud', () => {
    const problems = scriptChecks([[seg(`**Intro music plays** ${words(145)}`)]], { targetWords: 150, format: 'single' });
    expect(problems).toContainEqual(expect.objectContaining({ code: 'unspeakable' }));
  });
});

describe('judgeWindows', () => {
  it('judges a short script in one window', () => {
    expect(judgeWindows([100, 100, 100], 4500)).toEqual([[0, 1, 2]]);
  });

  it('splits a long script into windows under the word budget', () => {
    expect(judgeWindows([2000, 2000, 2000, 2000], 4500)).toEqual([[0, 1], [2, 3]]);
  });
});

describe('aggregateJudgements', () => {
  const s = (o: Partial<Record<string, number>>) => ({ model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5, instructions: 5, ...o });

  it('takes the best coverage across windows but the worst accuracy', () => {
    const agg = aggregateJudgements([
      { scores: s({ seeing: 2, accuracy: 5 }), problems: ['a'], sectionsToRevise: [1], revisionNotes: 'x' },
      { scores: s({ seeing: 5, accuracy: 3 }), problems: ['b'], sectionsToRevise: [3], revisionNotes: 'y' },
    ]);
    expect(agg.scores.seeing).toBe(5);
    expect(agg.scores.accuracy).toBe(3);
    expect(agg.problems).toEqual(['a', 'b']);
    expect(agg.sectionsToRevise).toEqual([1, 3]);
  });
});
