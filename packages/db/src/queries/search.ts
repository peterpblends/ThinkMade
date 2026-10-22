import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { queryRows } from '../client';

/**
 * Searchable text for a series: its public title and description, episode titles, descriptions and
 * learning objectives, mental model names and verified book titles. Never the owner's original question.
 */
export async function seriesSearchText(db: Db, seriesId: string): Promise<string> {
  const [row] = await queryRows<{ doc: string }>(
    db,
    sql`select s.title || ' ' || s.description || ' ' ||
          coalesce((select string_agg(e.title || ' ' || e.description || ' ' || coalesce(e.learning_objective, ''), ' ') from episode e where e.series_id = s.id and e.status = 'ready'), '') || ' ' ||
          coalesce((select string_agg(distinct m.name, ' ') from episode e join episode_mental_model em on em.episode_id = e.id join mental_model m on m.id = em.mental_model_id where e.series_id = s.id), '') || ' ' ||
          coalesce((select string_agg(distinct so.title, ' ') from episode e join episode_source es on es.episode_id = e.id join source so on so.id = es.source_id where e.series_id = s.id), '') as doc
        from podcast_series s where s.id = ${seriesId}`,
  );
  return row?.doc ?? '';
}

export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}
