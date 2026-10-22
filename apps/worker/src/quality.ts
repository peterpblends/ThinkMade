import { countWords } from '@thinkmade/ai';

import { CRITERIA, type Criterion, type Judgement } from '@thinkmade/shared';
export { CRITERIA, CRITERIA_LABELS, judgementSchema, VALIDATE_TASK, type Criterion, type Judgement } from '@thinkmade/shared';

type Segment = { speaker: 'A' | 'B'; text: string };

export interface CheckProblem {
  code: 'too_short' | 'too_long' | 'announced_labels' | 'one_sided' | 'repetition' | 'unspeakable';
  /** 1-based section number, or null for the whole script. */
  section: number | null;
  message: string;
}

/** Fast deterministic checks that do not need a model. */
export function scriptChecks(sections: Segment[][], opts: { targetWords: number; format: 'single' | 'two_hosts' }): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const all = sections.flat();
  const total = all.reduce((n, s) => n + countWords(s.text), 0);
  if (total < opts.targetWords * 0.75) {
    problems.push({ code: 'too_short', section: null, message: `The script has ${total} words; about ${opts.targetWords} are needed for the requested length.` });
  }
  if (total > opts.targetWords * 1.4) {
    problems.push({ code: 'too_long', section: null, message: `The script has ${total} words; about ${opts.targetWords} are needed for the requested length.` });
  }
  sections.forEach((segs, i) => {
    const text = segs.map((s) => s.text).join(' ');
    if (/(^|[.!?]\s+|\n)\s*(thinking|seeing|doing)\s*[:—-]/i.test(text) || /\b(the|our) (thinking|seeing|doing) (part|section|stage)\b/i.test(text)) {
      problems.push({ code: 'announced_labels', section: i + 1, message: 'Thinking, Seeing or Doing is announced as a label instead of woven into the conversation.' });
    }
    if (/(\*\*|__|#{1,6}\s|\[[^\]]*(music|laughs|pause|sound)[^\]]*\]|\((music|laughs|pause|sound)[^)]*\)|\*[^*]*(music|plays|laughs)[^*]*\*)/i.test(text)) {
      problems.push({ code: 'unspeakable', section: i + 1, message: 'Contains markdown or stage directions that would be read aloud.' });
    }
  });
  if (opts.format === 'two_hosts') {
    const b = all.filter((s) => s.speaker === 'B').reduce((n, s) => n + countWords(s.text), 0);
    if (b < total * 0.15) problems.push({ code: 'one_sided', section: null, message: 'In a two-host episode both hosts need a real share of the conversation.' });
  }
  const sentences = all.flatMap((s) => s.text.split(/(?<=[.!?])\s+/)).map((x) => x.trim().toLowerCase()).filter((x) => countWords(x) >= 6);
  if (sentences.length >= 6) {
    const counts = new Map<string, number>();
    for (const x of sentences) counts.set(x, (counts.get(x) ?? 0) + 1);
    const repeated = [...counts.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
    if (repeated / sentences.length > 0.25) problems.push({ code: 'repetition', section: null, message: 'Many sentences are repeated word for word.' });
  }
  return problems;
}

/** Groups consecutive sections into review windows that each stay under the word budget. */
export function judgeWindows(sectionWords: number[], maxWords: number): number[][] {
  const windows: number[][] = [];
  let current: number[] = [];
  let n = 0;
  sectionWords.forEach((w, i) => {
    if (current.length && n + w > maxWords) {
      windows.push(current);
      current = [];
      n = 0;
    }
    current.push(i);
    n += w;
  });
  if (current.length) windows.push(current);
  return windows;
}

const COVERAGE: Criterion[] = ['model', 'thinking', 'seeing', 'doing'];

/** Coverage can come from any window (best score); quality must hold everywhere (worst score). */
export function aggregateJudgements(js: Judgement[]): Judgement {
  const scores = Object.fromEntries(
    CRITERIA.map((c) => [c, COVERAGE.includes(c) ? Math.max(...js.map((j) => j.scores[c])) : Math.min(...js.map((j) => j.scores[c]))]),
  ) as Judgement['scores'];
  return {
    scores,
    problems: js.flatMap((j) => j.problems),
    sectionsToRevise: [...new Set(js.flatMap((j) => j.sectionsToRevise))].sort((a, b) => a - b),
    revisionNotes: js.map((j) => j.revisionNotes).filter(Boolean).join(' '),
  };
}

export function failingCriteria(scores: Judgement['scores'], minScore: number): Criterion[] {
  return CRITERIA.filter((c) => scores[c] < minScore);
}
