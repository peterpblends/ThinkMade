import { describe, expect, it } from 'vitest';
import { aggregateJudgements, judgeWindows, scriptChecks, swappedSpeakers } from './quality';

const seg = (text: string, speaker: 'A' | 'B' | 'C' = 'A') => ({ speaker, text });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';

describe('naturalness checks', () => {
  const codes = (sections: Array<Array<{ speaker: 'A' | 'B' | 'C'; text: string }>>, format: 'single' | 'two_hosts' = 'two_hosts') =>
    scriptChecks(sections, { targetWords: sections.flat().reduce((n, x) => n + x.text.split(' ').length, 0), format }).map((p) => [p.code, p.section]);

  it('flags stock phrases in the section they appear in', () => {
    const problems = scriptChecks([[seg(words(70))], [seg(`That's a great question. Let's dive in. ${words(70)}`)]], { targetWords: 150, format: 'single' });
    const stock = problems.find((p) => p.code === 'stock_phrases');
    expect(stock).toMatchObject({ section: 2 });
    expect(stock!.message).toContain('"great question"');
    expect(stock!.message).toContain('"let\'s dive in"');
  });

  it('flags hosts who keep opening by agreeing', () => {
    const agree = Array.from({ length: 8 }, (_, i) => seg(`${i % 2 ? 'Exactly.' : 'Absolutely!'} ${words(15 + (i % 3) * 10)}`, i % 2 ? 'B' : 'A'));
    expect(codes([agree])).toContainEqual(['echo_openers', 1]);
  });

  it('flags turns that are all the same length, but not a varied conversation', () => {
    const same = Array.from({ length: 12 }, (_, i) => seg(words(40), i % 2 ? 'B' : 'A'));
    expect(codes([same])).toContainEqual(['monotone_turns', null]);
    const varied = [60, 5, 45, 12, 70, 3, 38, 20, 55, 8, 40, 15].map((n, i) => seg(words(n), i % 2 ? 'B' : 'A'));
    expect(codes([varied]).map(([c]) => c)).not.toContain('monotone_turns');
  });

  it('flags a monologue in a conversation, but not in a solo story', () => {
    const monologue = [seg(words(250), 'A'), ...Array.from({ length: 6 }, (_, i) => seg(words(20 + i * 7), i % 2 ? 'A' : 'B'))];
    expect(codes([monologue])).toContainEqual(['monologue', 1]);
    expect(codes([[seg(words(250))]], 'single').map(([c]) => c)).not.toContain('monologue');
  });
});

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

describe('hosts and their lines', () => {
  const hosts = [
    { id: 'A', name: 'Emma' },
    { id: 'B', name: 'Edwin' },
  ];
  const turn = (speaker: 'A' | 'B', text: string) => ({ speaker, text });

  it('finds lines given to the wrong host from the start', () => {
    const swapped = [
      turn('A', `Welcome back. I'm Edwin, and this week we're looking at second-order thinking.`),
      turn('B', `And I'm Emma. It's one of my favourites.`),
      turn('A', 'Emma, where do you want to start?'),
      turn('B', 'With a story, actually.'),
    ];
    expect(swappedSpeakers(swapped, hosts)?.sort()).toEqual(['A', 'B']);
  });

  it('leaves a correctly assigned script alone', () => {
    const right = [
      turn('A', `Welcome back. I'm Emma, and this week we're looking at second-order thinking.`),
      turn('B', `And I'm Edwin. It's one of my favourites.`),
      turn('A', 'Edwin, where do you want to start?'),
      turn('B', 'With a story, actually.'),
    ];
    expect(swappedSpeakers(right, hosts)).toBeNull();
    expect(swappedSpeakers([turn('A', 'No names here.'), turn('B', 'None at all.')], hosts)).toBeNull();
  });

  it('flags hosts who keep opening with each other’s names', () => {
    const named = Array.from({ length: 10 }, (_, i) => turn(i % 2 ? 'B' : 'A', `${i % 2 ? 'Emma' : 'Edwin'}, ${words(20 + i * 3)}`));
    const problems = scriptChecks([named], { targetWords: 200, format: 'two_hosts', hosts });
    expect(problems.find((p) => p.code === 'name_openers')).toMatchObject({ section: 1 });
    const natural = named.map((x, i) => (i === 0 ? x : { ...x, text: x.text.replace(/^\w+, /, '') }));
    expect(scriptChecks([natural], { targetWords: 200, format: 'two_hosts', hosts }).map((p) => p.code)).not.toContain('name_openers');
  });

  it('flags turns that keep opening with the same word', () => {
    const so = Array.from({ length: 10 }, (_, i) => turn(i % 2 ? 'B' : 'A', `${i < 6 ? 'So' : 'Right'} ${words(20 + i * 3)}`));
    expect(scriptChecks([so], { targetWords: 200, format: 'two_hosts', hosts }).find((p) => p.code === 'same_openers')?.message).toContain('"so"');
    const varied = ['So', 'Hmm', 'Which', 'But', 'Right', 'Wait', 'Okay', 'Not', 'Yes', 'Exactly'].map((w, i) => turn(i % 2 ? 'B' : 'A', `${w} ${words(20 + i * 3)}`));
    expect(scriptChecks([varied], { targetWords: 200, format: 'two_hosts', hosts }).map((p) => p.code)).not.toContain('same_openers');
  });
});

describe('introductions', () => {
  it('finds swapped lines even when the introductions are the first words', () => {
    const hosts = [
      { id: 'A', name: 'Hadley' },
      { id: 'B', name: 'Parker' },
    ];
    expect(swappedSpeakers([{ speaker: 'A', text: "I'm Parker. That is the habit." }, { speaker: 'B', text: "And I'm Hadley. Here is how." }], hosts)?.sort()).toEqual(['A', 'B']);
  });
});
