import { countWords } from '@thinkmade/ai';

import { CRITERIA, type Criterion, type Judgement } from '@thinkmade/shared';

/** One host, a two-host conversation, or a group of three or four hosts. */
export type EpisodeFormat = 'single' | 'two_hosts' | 'group';
export { CRITERIA, CRITERIA_LABELS, judgementSchema, VALIDATE_TASK, type Criterion, type Judgement } from '@thinkmade/shared';

type Segment = { speaker: string; text: string };

export interface CheckProblem {
  code: 'too_short' | 'too_long' | 'announced_labels' | 'one_sided' | 'repetition' | 'unspeakable' | 'stock_phrases' | 'echo_openers' | 'monotone_turns' | 'monologue';
  /** 1-based section number, or null for the whole script. */
  section: number | null;
  message: string;
}

/** Phrases that make a script sound generated rather than spoken. */
export const STOCK_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgreat question\b/i, '"great question"'],
  [/\bthat'?s a great point\b/i, '"that\'s a great point"'],
  [/\blet'?s dive (?:in|into|right in)\b/i, '"let\'s dive in"'],
  [/\bdive deep(?:er)? into\b/i, '"dive deep into"'],
  [/\bdelv(?:e|ing)\b/i, '"delve"'],
  [/\bin today'?s episode\b/i, '"in today\'s episode"'],
  [/\bbuckle up\b/i, '"buckle up"'],
  [/\bgame[- ]changer\b/i, '"game-changer"'],
  [/\bit'?s important to note\b/i, '"it\'s important to note"'],
  [/\bin conclusion\b/i, '"in conclusion"'],
  [/\bat the end of the day\b/i, '"at the end of the day"'],
  [/\bwithout further ado\b/i, '"without further ado"'],
];
const AGREEMENT_OPENER = /^\s*(?:exactly|absolutely|totally|right|yes|yeah|great|definitely|i agree|so true)\b[\s,.!—-]/i;

/** Fast deterministic checks that do not need a model. */
export function scriptChecks(sections: Segment[][], opts: { targetWords: number; format: EpisodeFormat; hostIds?: string[] }): CheckProblem[] {
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
    const stock = STOCK_PHRASES.filter(([re]) => re.test(text)).map(([, label]) => label);
    if (stock.length) {
      problems.push({ code: 'stock_phrases', section: i + 1, message: `Sounds scripted: avoid stock phrases (${stock.slice(0, 4).join(', ')}).` });
    }
    if (opts.format !== 'single' && segs.length >= 6) {
      // Constant agreement ("Exactly.", "Absolutely!", "Right,") makes hosts sound like they're reading.
      const echo = segs.filter((x) => AGREEMENT_OPENER.test(x.text)).length;
      if (echo / segs.length > 0.3) problems.push({ code: 'echo_openers', section: i + 1, message: 'Too many turns open by agreeing ("Exactly", "Right", "Absolutely"). React to the actual point, and disagree or ask where it fits.' });
      const long = segs.find((x) => countWords(x.text) > 230);
      if (long) problems.push({ code: 'monologue', section: i + 1, message: 'One turn runs on for too long; break it up with the other host reacting, questioning or adding a story.' });
    }
    if (/(^|[.!?]\s+|\n)\s*(thinking|seeing|doing)\s*[:—-]/i.test(text) || /\b(the|our) (thinking|seeing|doing) (part|section|stage)\b/i.test(text)) {
      problems.push({ code: 'announced_labels', section: i + 1, message: 'Thinking, Seeing or Doing is announced as a label instead of woven into the conversation.' });
    }
    if (/(\*\*|__|#{1,6}\s|\[[^\]]*(music|laughs|pause|sound)[^\]]*\]|\((music|laughs|pause|sound)[^)]*\)|\*[^*]*(music|plays|laughs)[^*]*\*)/i.test(text)) {
      problems.push({ code: 'unspeakable', section: i + 1, message: 'Contains markdown or stage directions that would be read aloud.' });
    }
  });
  if (opts.format !== 'single') {
    // Every host needs a real share: at least 15% of the words with two hosts, 10% with three, 7.5% with four.
    const ids = opts.hostIds ?? ['A', 'B'];
    const quiet = ids.filter((id) => all.filter((s) => s.speaker === id).reduce((n, s) => n + countWords(s.text), 0) < (total * 0.3) / ids.length);
    if (quiet.length) problems.push({ code: 'one_sided', section: null, message: `Every host needs a real share of the conversation; host ${quiet.join(' and ')} barely speaks.` });
  }
  if (opts.format !== 'single' && all.length >= 10) {
    // Paragraph after paragraph of the same length reads like alternating essays, not a conversation.
    const lens = all.map((x) => countWords(x.text));
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (mean > 0 && sd / mean < 0.3) {
      problems.push({ code: 'monotone_turns', section: null, message: 'Every turn is about the same length, like alternating paragraphs. Mix quick reactions and questions with longer stories.' });
    }
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
