import { sql } from 'drizzle-orm';
import { queryRows, type Db } from '@thinkmade/db';

/**
 * General-purpose "latticework" models that language models reach for on almost any question. They are
 * useful, but a series built from them feels the same whatever was asked, so they are only chosen when
 * nothing closer to the person's topic fits as well.
 */
export const GENERIC_MODELS = [
  'first-principles',
  'first-principles-thinking',
  'inversion',
  'second-order-thinking',
  'opportunity-cost',
  'circle-of-competence',
  'map-is-not-the-territory',
  'the-map-is-not-the-territory',
  'occams-razor',
  'hanlons-razor',
  'margin-of-safety',
  'feedback-loops',
  'incentives',
  'pareto-principle',
  'sunk-cost-fallacy',
  'confirmation-bias',
  'regression-to-the-mean',
  'compounding',
  'thought-experiment',
  'probabilistic-thinking',
  'systems-thinking',
  'growth-mindset',
  'eisenhower-matrix',
  'cognitive-biases',
  'theory-of-constraints',
] as const;

const FILLER = new Set(['the', 'a', 'an', 'of', 'thinking', 'principle', 'effect', 'law', 'model', 'theory', 'fallacy', 'bias', 'rule', 'razor', 'and']);

/** A name reduced to its core words, so near-synonyms ("Inversion Thinking", "The Inversion Principle") match. */
export function modelKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .sort()
    .join(' ');
}

const GENERIC_KEYS = new Set(GENERIC_MODELS.map((s) => modelKey(s.replace(/-/g, ' '))));

/**
 * Primary models ThinkMade has taught most in the last six months, across everyone: the AI's favourites.
 * Passed to model selection so new series reach for something else.
 */
export async function overusedModels(db: Db, limit = 30): Promise<Array<{ slug: string; name: string; uses: number }>> {
  return queryRows<{ slug: string; name: string; uses: number }>(
    db,
    sql`select m.slug, m.name, count(*)::int as uses
        from episode_mental_model em
        join mental_model m on m.id = em.mental_model_id
        join episode e on e.id = em.episode_id
        where em.role = 'primary' and e.created_at > now() - interval '180 days'
        group by m.slug, m.name
        having count(*) >= 2
        order by uses desc
        limit ${limit}`,
  );
}

export interface Candidate {
  slug: string;
  name: string;
  score: number;
}

/**
 * Orders candidate models for a series: drops near-duplicates, then puts topic-specific models first and
 * generic or recently overused ones after them, each group by the model's own score. A series takes models
 * from the front, so common models are only taught when there aren't enough specific ones; they stay in the
 * list as spares (for example, when episodes are added later). Slugs in `keep` (deepen and reinforce) are
 * never counted as common.
 */
export function rankForVariety<T extends Candidate>(candidates: T[], opts: { overused: Iterable<string>; keep?: ReadonlySet<string> }): T[] {
  const overusedKeys = new Set([...opts.overused].map((s) => modelKey(s.replace(/-/g, ' '))));
  const keys = (c: T) => [modelKey(c.name), modelKey(c.slug.replace(/-/g, ' '))];
  const isCommon = (c: T) => !opts.keep?.has(c.slug) && keys(c).some((k) => GENERIC_KEYS.has(k) || overusedKeys.has(k));
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const k = modelKey(c.name);
    if (seen.has(k) || seen.has(c.slug)) return false;
    seen.add(k);
    seen.add(c.slug);
    return true;
  });
  const byScore = (a: T, b: T) => b.score - a.score;
  return [...unique.filter((c) => !isCommon(c)).sort(byScore), ...unique.filter(isCommon).sort(byScore)];
}
