import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { indexSeriesEmbedding, queryRows, schema, vectorLiteral } from '@thinkmade/db';
import { BRAND } from '@thinkmade/shared';
import type { AppContext } from '../create-context';
import { requireVerified, type AppVariables } from '../middleware/session';
import { episodeDetails, serialiseEpisode } from './series';

type Hit = {
  id: string;
  title: string;
  description: string;
  public_slug: string;
  created_at: string;
  rank: number;
  similarity: number;
  episode_count: number;
  total_seconds: number;
  saves: number;
  avg_rating: number | null;
};

/** Updates a public series' search vector. If the embedder can't run here, the worker indexes it later. */
export async function indexSeries(ctx: AppContext, seriesId: string) {
  await indexSeriesEmbedding(ctx.db, await ctx.embedder(), seriesId);
}

/** The query's vector, or null for text-only search when the embedder is unavailable or slow. */
async function queryVector(ctx: AppContext, q: string): Promise<{ vec: number[]; model: string } | null> {
  try {
    const embedder = await ctx.embedder();
    const [vec] = await embedder.embed([q], 'query');
    return vec ? { vec, model: embedder.name } : null;
  } catch {
    return null;
  }
}

/**
 * Public, finished series ranked by full-text match plus vector similarity. Private series are
 * excluded in SQL, not filtered afterwards.
 */
async function searchPublic(ctx: AppContext, opts: { q?: string | undefined; model?: string | undefined; excludeUserId?: string; minSimilarity?: number; limit?: number }): Promise<Hit[]> {
  const q = opts.q?.trim().slice(0, 200) ?? '';
  const qv = q ? await queryVector(ctx, q) : null;
  const vecLit = qv ? vectorLiteral(qv.vec) : null;
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const minSim = opts.minSimilarity ?? 0.3;
  return queryRows<Hit>(
    ctx.db,
    sql`with docs as (
          select s.id, s.title, s.description, s.public_slug, s.created_at, s.embedding, s.embedding_model, s.user_id,
            s.title || ' ' || s.description || ' ' ||
            coalesce((select string_agg(e.title || ' ' || e.description || ' ' || coalesce(e.learning_objective, ''), ' ') from episode e where e.series_id = s.id and e.status = 'ready'), '') || ' ' ||
            coalesce((select string_agg(distinct m.name, ' ') from episode e join episode_mental_model em on em.episode_id = e.id join mental_model m on m.id = em.mental_model_id where e.series_id = s.id), '') || ' ' ||
            coalesce((select string_agg(distinct so.title, ' ') from episode e join episode_source es on es.episode_id = e.id join source so on so.id = es.source_id where e.series_id = s.id), '') as doc
          from podcast_series s
          where s.visibility = 'public' and s.status in ('ready', 'partial')
            ${opts.excludeUserId ? sql`and s.user_id <> ${opts.excludeUserId}` : sql``}
            ${opts.model ? sql`and exists (select 1 from episode e join episode_mental_model em on em.episode_id = e.id join mental_model m on m.id = em.mental_model_id where e.series_id = s.id and m.slug = ${opts.model})` : sql``}
        ),
        scored as (
          select d.*,
            ${q ? sql`ts_rank(to_tsvector('english', d.doc), websearch_to_tsquery('english', ${q}))` : sql`0`}::float as rank,
            ${vecLit ? sql`case when d.embedding is null or d.embedding_model is distinct from ${qv!.model} then 0 else 1 - (d.embedding <=> ${vecLit}::vector) end` : sql`0`}::float as similarity,
            ${q ? sql`(to_tsvector('english', d.doc) @@ websearch_to_tsquery('english', ${q}) or d.doc ilike ${like})` : sql`true`} as text_match
          from docs d
        )
        select sc.id, sc.title, sc.description, sc.public_slug, sc.created_at, sc.rank, sc.similarity,
          (select count(*)::int from episode e where e.series_id = sc.id and e.status = 'ready') as episode_count,
          (select coalesce(sum(e.duration_seconds), 0)::float from episode e where e.series_id = sc.id and e.status = 'ready') as total_seconds,
          (select count(*)::int from library_item li where li.series_id = sc.id and li.user_id <> sc.user_id) as saves,
          (select avg(r.stars)::float from rating r join episode e on e.id = r.episode_id where e.series_id = sc.id) as avg_rating
        from scored sc
        where ${q ? sql`(sc.text_match or sc.similarity >= ${minSim})` : sql`true`}
        order by ${q ? sql`(sc.rank * 4 + sc.similarity) desc` : sql`sc.created_at desc`}
        limit ${opts.limit ?? 20}`,
  );
}

async function modelsFor(ctx: AppContext, ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  const rows = await ctx.db
    .selectDistinct({ seriesId: schema.episode.seriesId, name: schema.mentalModel.name })
    .from(schema.episodeMentalModel)
    .innerJoin(schema.episode, eq(schema.episode.id, schema.episodeMentalModel.episodeId))
    .innerJoin(schema.mentalModel, eq(schema.mentalModel.id, schema.episodeMentalModel.mentalModelId))
    .where(and(inArray(schema.episode.seriesId, ids), eq(schema.episodeMentalModel.role, 'primary')));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.seriesId, [...(out.get(r.seriesId) ?? []), r.name]);
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Sets the page title and Open Graph tags so shared links preview properly. */
export function withPreviewTags(html: string, meta: { title: string; description: string; url: string; noindex?: boolean }): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description.slice(0, 280));
  const u = escapeHtml(meta.url);
  let out = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${d}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, () => `<meta property="og:title" content="${t}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, () => `<meta property="og:description" content="${d}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/, () => `<meta property="og:url" content="${u}" />`);
  if (meta.noindex) out = out.replace('</head>', '<meta name="robots" content="noindex" />\n</head>');
  return out;
}

export function discoverRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.get('/discover', async (c) => {
    const hits = await searchPublic(ctx, { q: c.req.query('q'), model: c.req.query('model') });
    const models = await modelsFor(ctx, hits.map((h) => h.id));
    return c.json({
      results: hits.map((h) => ({
        id: h.id,
        title: h.title,
        description: h.description,
        publicSlug: h.public_slug,
        createdAt: h.created_at,
        models: models.get(h.id) ?? [],
        episodeCount: h.episode_count,
        totalSeconds: h.total_seconds,
        saves: h.saves,
        averageRating: h.avg_rating,
      })),
    });
  });

  r.post('/discover/suggest', requireVerified(), async (c) => {
    const body = z.object({ topic: z.string().trim().min(3).max(2000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ suggestions: [] });
    const hits = await searchPublic(ctx, { q: body.data.topic, excludeUserId: c.var.session!.user.id, minSimilarity: 0.35, limit: 3 });
    const strong = hits.filter((h) => h.similarity >= 0.35 || h.rank >= 0.05);
    const models = await modelsFor(ctx, strong.map((h) => h.id));
    return c.json({ suggestions: strong.map((h) => ({ id: h.id, title: h.title, description: h.description, publicSlug: h.public_slug, models: models.get(h.id) ?? [], similarity: Number(h.similarity.toFixed(3)) })) });
  });

  r.get('/public/:slug', async (c) => {
    const [s] = await ctx.db
      .select()
      .from(schema.podcastSeries)
      .where(and(eq(schema.podcastSeries.publicSlug, c.req.param('slug')), eq(schema.podcastSeries.visibility, 'public')));
    if (!s) return c.json({ error: 'not_found' }, 404);
    const eps = await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, s.id)).orderBy(schema.episode.number);
    const details = await episodeDetails(ctx.db, eps.map((e) => e.id));
    return c.json({
      id: s.id,
      title: s.title,
      description: s.description,
      status: s.status,
      visibility: s.visibility,
      publicSlug: s.publicSlug,
      isOwner: s.userId === c.var.session?.user.id,
      createdAt: s.createdAt,
      episodes: eps.filter((e) => e.status === 'ready').map((e) => serialiseEpisode(e, details.get(e.id))),
    });
  });

  return r;
}

/** Server-rendered entry for shared links (/p/:slug): the app, with preview tags for that series. */
export function sharePageRoutes(ctx: AppContext) {
  const r = new Hono();
  r.get('/p/:slug', async (c) => {
    const html = await ctx.indexHtml();
    const [s] = await ctx.db
      .select({ title: schema.podcastSeries.title, description: schema.podcastSeries.description })
      .from(schema.podcastSeries)
      .where(and(eq(schema.podcastSeries.publicSlug, c.req.param('slug')), eq(schema.podcastSeries.visibility, 'public')));
    const url = `${ctx.env.APP_URL}/p/${encodeURIComponent(c.req.param('slug'))}`;
    if (!s) return c.html(withPreviewTags(html, { title: `${BRAND.name}`, description: BRAND.shortDescription, url, noindex: true }), 404);
    return c.html(withPreviewTags(html, { title: `${s.title} — ${BRAND.name}`, description: s.description, url }));
  });
  // A shared episode: its own title and description in link previews.
  r.get('/p/:slug/e/:number', async (c) => {
    const html = await ctx.indexHtml();
    const slug = c.req.param('slug');
    const number = Number(c.req.param('number'));
    const url = `${ctx.env.APP_URL}/p/${encodeURIComponent(slug)}/e/${number}`;
    const [row] = Number.isInteger(number)
      ? await ctx.db
          .select({ title: schema.episode.title, description: schema.episode.description, seriesTitle: schema.podcastSeries.title })
          .from(schema.episode)
          .innerJoin(schema.podcastSeries, eq(schema.podcastSeries.id, schema.episode.seriesId))
          .where(and(eq(schema.podcastSeries.publicSlug, slug), eq(schema.podcastSeries.visibility, 'public'), eq(schema.episode.number, number), eq(schema.episode.status, 'ready')))
      : [];
    if (!row) return c.html(withPreviewTags(html, { title: `${BRAND.name}`, description: BRAND.shortDescription, url, noindex: true }), 404);
    return c.html(withPreviewTags(html, { title: `${row.title} — ${row.seriesTitle}`, description: row.description, url }));
  });
  return r;
}
