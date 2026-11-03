import { textOf, type ChatMessage } from '@thinkmade/ai';

const POOL = [
  ['opportunity-cost', 'Opportunity Cost', 'The value of the best alternative you give up when you choose.'],
  ['second-order-thinking', 'Second-Order Thinking', 'Asking what happens after the obvious first consequence.'],
  ['theory-of-constraints', 'Theory of Constraints', 'A system’s output is limited by its tightest bottleneck.'],
  ['inversion', 'Inversion', 'Solve a problem by asking how to guarantee failure, then avoid that.'],
  ['circle-of-competence', 'Circle of Competence', 'Know the boundaries of what you genuinely understand.'],
  ['first-principles', 'First Principles Thinking', 'Rebuild a problem from its fundamental truths.'],
  ['margin-of-safety', 'Margin of Safety', 'Leave room for error between plan and reality.'],
  ['feedback-loops', 'Feedback Loops', 'Outputs that circle back to amplify or dampen a system.'],
  ['incentives', 'Incentives', 'People respond to how they are rewarded and penalised.'],
  ['map-is-not-the-territory', 'The Map Is Not the Territory', 'Models simplify reality and can mislead.'],
  ['hanlons-razor', 'Hanlon’s Razor', 'Do not attribute to malice what is explained by error.'],
  ['regression-to-the-mean', 'Regression to the Mean', 'Extreme results tend to be followed by ordinary ones.'],
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture reads arbitrary stage input
function inputOf(messages: ChatMessage[]): Record<string, any> {
  const content = messages.find((m) => m.role === 'user')?.content ?? '';
  const text = typeof content === 'string' ? content : (content.find((p) => p.type === 'text') as { text: string } | undefined)?.text ?? '';
  const i = text.indexOf('INPUT:');
  return i >= 0 ? JSON.parse(text.slice(i + 6)) : {};
}

const SENTENCES = [
  'Think about the last time a decision felt obvious and still turned out badly.',
  'The useful question is what you gave up without noticing.',
  'Here is how to spot it: look for the option nobody wrote down.',
  'Imagine a small team choosing between two projects with the same budget.',
  'The first step is to name the real alternative, not a straw man.',
  'Then put a rough value on it, even if the number is uncertain.',
  'Notice how the choice changes once the hidden cost is on the table.',
  'That is the habit worth practising this week.',
];

let sentenceCounter = 0;
const ORDINALS = ['first', 'next', 'another', 'a further', 'one more', 'a final'];
/** Distinct sentences (so the repetition check passes) of roughly `target` words. */
function words(target: number): string {
  const out: string[] = [];
  let n = 0;
  while (n < target) {
    const k = sentenceCounter++;
    const base = SENTENCES[k % SENTENCES.length]!.replace(/\.$/, '');
    const s = `${base}, which is the ${ORDINALS[k % ORDINALS.length]} idea in thread ${Math.floor(k / SENTENCES.length) + 1}.`;
    out.push(s);
    n += s.split(' ').length;
  }
  return out.join(' ');
}

const STOPWORDS = new Set(['why', 'do', 'does', 'my', 'our', 'the', 'a', 'an', 'how', 'i', 'can', 'to', 'in', 'of', 'and', 'is', 'me', 'help', 'with', 'what', 'about']);
/** A lower-case keyword paraphrase, as a real model would summarise rather than quote. */
function keywords(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOPWORDS.has(w)).slice(0, 8).join(' ') || 'this question';
}

/**
 * Deterministic model for tests and offline demos. It reads the STAGE marker and INPUT block and returns
 * well-formed JSON for that stage, including one unverifiable book per model so verification is exercised.
 */
export function fakeResponder(messages: ChatMessage[]): string {
  const system = textOf(messages.find((m) => m.role === 'system')?.content ?? '');
  const stage = system.match(/^STAGE: (\w+)/)?.[1];
  const inp = inputOf(messages);
  switch (stage) {
    case 'understand':
      return JSON.stringify({
        objective: `Learn to think clearly about: ${String(inp.question || 'the topic').slice(0, 200)}`,
        context: 'Asked in their own words.',
        audience: 'A thoughtful professional',
        keyQuestions: ['What am I missing?', 'What should I do first?'],
        evidence: inp.question ? [String(inp.question).slice(0, 200)] : [],
        assumptions: ['They want practical steps they can use this week.'],
        seriesTitle: 'Thinking It Through',
        seriesDescription: `A short series on the mental models behind ${keywords(String(inp.question ?? ''))}, drawn from the best books on each.`,
      });
    case 'select_models': {
      const covered: string[] = inp.coveredModels ?? [];
      const pool = inp.learningMode === 'explore' ? POOL.filter(([s]) => !covered.includes(s)) : POOL;
      return JSON.stringify({
        models: pool.slice(0, inp.count ?? 3).map(([slug, name, summary], i) => ({ name, slug, summary, category: 'decision-making', relevance: 'Directly useful for the objective.', score: 0.95 - i * 0.05 })),
      });
    }
    case 'translate': {
      // Marks text as translated, keeping the structure, so tests can tell a translation from the original.
      const tag = `[${String(inp.targetLanguage ?? '?').split(' ')[0]}]`;
      if (Array.isArray(inp.segments)) return JSON.stringify({ segments: inp.segments.map((s: { speaker: string; text: string }) => ({ speaker: s.speaker, text: `${tag} ${s.text}` })) });
      return JSON.stringify({
        series: { title: `${tag} ${inp.series?.title ?? ''}`, description: `${tag} ${inp.series?.description ?? ''}` },
        episodes: (inp.episodes ?? []).map((e: Record<string, unknown>) => ({ ...e, title: `${tag} ${String(e.title)}`, description: `${tag} ${String(e.description)}` })),
      });
    }
    case 'research':
      return JSON.stringify({
        models: (inp.models ?? []).map((m: { slug: string; name: string }) => ({
          slug: m.slug,
          books: [
            { title: `The Book of ${m.name}`, author: 'Ada Author', why: 'The standard introduction.' },
            { title: 'Totally Invented Title', author: 'Nobody Real', why: 'Should be rejected by verification.' },
          ],
          related: [{ name: 'Inversion', relation: 'complementary' }],
        })),
      });
    case 'plan':
      return JSON.stringify({
        episodes: (inp.episodes ?? []).map((e: { number: number; primaryModelSlug: string; sections: number }) => ({
          number: e.number,
          title: `Episode ${e.number}: ${e.primaryModelSlug.replace(/-/g, ' ')}`,
          description: `How ${e.primaryModelSlug.replace(/-/g, ' ')} helps with the question.`,
          primaryModelSlug: e.primaryModelSlug,
          supportingModelSlugs: [],
          learningObjective: 'Understand the model, notice when it applies, and use it on a real decision.',
          outcomes: {
            thinking: 'Explain the model and why it works, including its limits.',
            seeing: 'Spot the signals that this model is relevant.',
            doing: 'Apply it step by step to a current decision.',
          },
          keyTakeaways: ['Name the real alternative.', 'Put a rough value on it.'],
          examples: [{ title: 'Two projects, one budget', kind: 'hypothetical', summary: 'A team weighs two projects.' }],
          sections: Array.from({ length: e.sections }, (_, i) => ({ heading: `Part ${i + 1}`, goal: 'Teach, show and practise the model.' })),
        })),
      });
    case 'script': {
      const ids: string[] = inp.format === 'single' ? ['A'] : (inp.hosts ?? [{ speaker: 'A' }, { speaker: 'B' }]).map((h: { speaker: string }) => h.speaker);
      const total = Number(inp.targetWords ?? 100);
      const turns = Math.max(2, Math.round(total / 40));
      const per = Math.max(8, Math.round(total / turns));
      return JSON.stringify({
        // Like a real conversation, turns vary: longer stories between quick reactions (same total length).
        segments: Array.from({ length: Math.max(turns, ids.length) }, (_, i) => ({ speaker: ids[i % ids.length], text: words(Math.max(4, Math.round(per * [1.5, 0.5, 1.2, 0.8][i % 4]!))) })),
        summary: `Covered ${inp.section?.heading ?? 'a section'}.`,
      });
    }
    case 'validate':
      return JSON.stringify(fakeValidation(inp));
    case 'vision':
      return JSON.stringify({
        summary: 'A workstation with materials stacked beside it.',
        visibleEvidence: ['Boxes are queued at one station', 'Two people are working'],
        assumptions: ['The queue may mean this station is the bottleneck'],
        visibleText: '',
      });
    case 'planner': {
      // Asks one clarifying question, then (once the listener has answered) sets up the podcast.
      const turns = messages.filter((m) => m.role === 'user').length;
      return turns < 2
        ? 'Got it. What would you most like to be able to do differently once you have listened?\nSETTINGS: {}'
        : 'Great, I have set up three short episodes with two hosts to help you decide with more confidence.\nSETTINGS: {"brief": "I want to make better decisions under pressure at work.", "episodes": 3, "lengthMinutes": 10, "speakerFormat": "two_hosts", "learningMode": "deepen", "ready": true}';
    }
    case 'coach':
      return 'Start by naming the alternative you are giving up, then estimate its value. What would you be giving up here?';
    default:
      return '{}';
  }
}

/** Overridable by tests that need a failing quality check. */
export let fakeValidation = (_inp: unknown) => ({
  scores: { model: 5, thinking: 5, seeing: 5, doing: 5, flow: 5, accuracy: 5, sources: 5, repetition: 5 },
  passed: true,
  problems: [] as string[],
  revisionNotes: '',
});
export function setFakeValidation(fn: typeof fakeValidation) {
  fakeValidation = fn;
}

/** Book verifier for tests: anything except the deliberately invented title verifies. */
export async function fakeVerifyBook(claim: { title: string; author: string }) {
  if (/invented/i.test(claim.title)) return { verified: false as const, reason: 'no_match' as const };
  return { verified: true as const, via: 'openlibrary' as const, title: claim.title, authors: [claim.author], year: 2001, openLibraryId: `/works/OL${claim.title.length}${claim.author.length}W` };
}
