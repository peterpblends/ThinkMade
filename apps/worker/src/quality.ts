import { z } from 'zod';
import { countWords } from '@thinkmade/ai';

export const CRITERIA = ['model', 'thinking', 'seeing', 'doing', 'flow', 'accuracy', 'sources', 'repetition'] as const;
export type Criterion = (typeof CRITERIA)[number];
type Segment = { speaker: 'A' | 'B'; text: string };

/** Plain-language names used in reviewer notes and the admin dashboard. */
export const CRITERIA_LABELS: Record<Criterion, string> = {
  model: 'Teaches a clearly identified mental model',
  thinking: 'Listener understands the model',
  seeing: 'Listener learns when to recognise opportunities to use it',
  doing: 'Listener understands practical application',
  flow: 'Discussion flows naturally',
  accuracy: 'Information is accurate',
  sources: 'Supporting sources are credible and verified',
  repetition: 'Avoids unnecessary repetition',
};

const score = z.coerce.number().int().min(1).max(5);
export const judgementSchema = z.object({
  scores: z.object(Object.fromEntries(CRITERIA.map((c) => [c, score])) as Record<Criterion, typeof score>),
  problems: z.array(z.string().max(400)).max(20).default([]),
  sectionsToRevise: z.array(z.coerce.number().int().min(1)).max(20).default([]),
  revisionNotes: z.string().max(2000).default(''),
});
export type Judgement = z.infer<typeof judgementSchema>;

export const VALIDATE_TASK = `
You are the quality reviewer. Grade this podcast script before it is turned into audio. Score each criterion from 1 (absent or wrong) to 5 (excellent):
- model: the episode teaches the named primary mental model clearly.
- thinking: the listener will understand what the model is, why it works, its assumptions and limits.
- seeing: the listener learns the signals and situations where it applies, and where it does not.
- doing: the listener sees step-by-step practical application with concrete examples.
- flow: it sounds like a natural, engaging conversation, not a lecture with announced sections; hosts have real roles.
- accuracy: claims are accurate; nothing invented (books, quotes, studies, statistics, cases); hypotheticals are labelled.
- sources: only books from the verified list are named, with correct authors; no quotations from them.
- repetition: no needless repetition within the script or of earlier sections.
You are reviewing a window of the script (sections listed). Judge coverage criteria on what you can see; the full episode outcomes are given for context.
List concrete problems, the section numbers that must be rewritten, and specific revision notes the writer can act on.
Shape: {"scores": {"model": n, "thinking": n, "seeing": n, "doing": n, "flow": n, "accuracy": n, "sources": n, "repetition": n}, "problems": string[], "sectionsToRevise": number[], "revisionNotes": string}`;

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
