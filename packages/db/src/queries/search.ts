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

/** The part of an embedder these queries need (packages/ai's Embedder satisfies it). */
export interface SearchEmbedder {
  readonly name: string;
  embed(texts: string[], kind?: 'query' | 'document'): Promise<number[][]>;
}

/** Embeds a series' search text and records which embedder made the vector. */
export async function indexSeriesEmbedding(db: Db, embedder: SearchEmbedder, seriesId: string): Promise<void> {
  const [v] = await embedder.embed([await seriesSearchText(db, seriesId)], 'document');
  if (v) await db.execute(sql`update podcast_series set embedding = ${vectorLiteral(v)}::vector, embedding_model = ${embedder.name} where id = ${seriesId}`);
}

/** Public, finished series with no vector from `embedderName` (new, or made by a previous embedder). */
export async function seriesNeedingIndex(db: Db, embedderName: string, limit = 20): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    db,
    sql`select id from podcast_series
        where visibility = 'public' and status in ('ready', 'partial')
          and (embedding is null or embedding_model is distinct from ${embedderName})
        order by updated_at desc limit ${limit}`,
  );
  return rows.map((r) => r.id);
}
