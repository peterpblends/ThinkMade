import { Readable } from 'node:stream';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema, type Db } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { requireSession, type AppVariables } from '../middleware/session';

/** Owner, or anyone when the series is public. Returns null otherwise so callers answer 404. */
export async function readableSeries(db: Db, seriesId: string, userId: string | null) {
  const [s] = await db
    .select()
    .from(schema.podcastSeries)
    .where(
      and(
        eq(schema.podcastSeries.id, seriesId),
        userId ? or(eq(schema.podcastSeries.userId, userId), eq(schema.podcastSeries.visibility, 'public')) : eq(schema.podcastSeries.visibility, 'public'),
      ),
    );
  return s ?? null;
}

export async function episodeDetails(db: Db, episodeIds: string[]) {
  if (!episodeIds.length) return new Map<string, { models: Array<{ slug: string; name: string; summary: string; role: string }>; sources: Array<{ title: string; url: string | null; verifiedVia: string | null; kind: string }> }>();
  const models = await db
    .select({ episodeId: schema.episodeMentalModel.episodeId, role: schema.episodeMentalModel.role, slug: schema.mentalModel.slug, name: schema.mentalModel.name, summary: schema.mentalModel.summary })
    .from(schema.episodeMentalModel)
    .innerJoin(schema.mentalModel, eq(schema.mentalModel.id, schema.episodeMentalModel.mentalModelId))
    .where(inArray(schema.episodeMentalModel.episodeId, episodeIds));
  const sources = await db
    .select({ episodeId: schema.episodeSource.episodeId, title: schema.source.title, url: schema.source.url, verifiedVia: schema.source.verifiedVia, kind: schema.source.kind })
    .from(schema.episodeSource)
    .innerJoin(schema.source, eq(schema.source.id, schema.episodeSource.sourceId))
    .where(inArray(schema.episodeSource.episodeId, episodeIds));
  const out = new Map<string, { models: typeof models; sources: typeof sources }>();
  for (const id of episodeIds) out.set(id, { models: models.filter((m) => m.episodeId === id), sources: sources.filter((s) => s.episodeId === id) });
  return out as never;
}

export function serialiseEpisode(
  e: typeof schema.episode.$inferSelect,
  details: { models: Array<{ slug: string; name: string; summary: string; role: string }>; sources: Array<{ title: string; url: string | null; verifiedVia: string | null; kind: string }> } | undefined,
  opts: { transcript?: boolean } = {},
) {
  const primary = details?.models.find((m) => m.role === 'primary') ?? null;
  return {
    id: e.id,
    seriesId: e.seriesId,
    number: e.number,
    title: e.title,
    description: e.description,
    status: e.status,
    learningObjective: e.learningObjective,
    speakerFormat: e.speakerFormat,
    hosts: (e.hosts ?? []).map((h) => ({ name: h.name })),
    plannedMinutes: e.plannedMinutes,
    durationSeconds: e.durationSeconds,
    outcomes: e.outcomes,
    keyTakeaways: e.keyTakeaways,
    examples: e.examples,
    primaryModel: primary && { slug: primary.slug, name: primary.name, summary: primary.summary },
    supportingModels: (details?.models ?? []).filter((m) => m.role !== 'primary').map((m) => ({ slug: m.slug, name: m.name })),
    sources: (details?.sources ?? []).map((s) => ({ title: s.title, url: s.url, kind: s.kind, verifiedVia: s.verifiedVia })),
    audioUrl: e.status === 'ready' && e.audioKey ? `/api/episodes/${e.id}/audio` : null,
    ...(opts.transcript ? { transcript: e.transcript } : {}),
  };
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return 'invalid';
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

export function seriesRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.get('/series', requireSession(), async (c) => {
    const userId = c.var.session!.user.id;
    const rows = await ctx.db
      .select({
        id: schema.podcastSeries.id,
        title: schema.podcastSeries.title,
        description: schema.podcastSeries.description,
        status: schema.podcastSeries.status,
        visibility: schema.podcastSeries.visibility,
        createdAt: schema.podcastSeries.createdAt,
        episodeCount: sql<number>`(select count(*)::int from episode e where e.series_id = "podcast_series"."id")`,
        readyCount: sql<number>`(select count(*)::int from episode e where e.series_id = "podcast_series"."id" and e.status = 'ready')`,
        totalSeconds: sql<number>`(select coalesce(sum(e.duration_seconds), 0)::float from episode e where e.series_id = "podcast_series"."id" and e.status = 'ready')`,
      })
      .from(schema.podcastSeries)
      .where(eq(schema.podcastSeries.userId, userId))
      .orderBy(desc(schema.podcastSeries.createdAt));
    return c.json({ series: rows });
  });

  r.get('/series/:id', async (c) => {
    const s = await readableSeries(ctx.db, c.req.param('id'), c.var.session?.user.id ?? null);
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
      episodes: eps.map((e) => serialiseEpisode(e, details.get(e.id))),
    });
  });

  r.get('/episodes/:id', async (c) => {
    const [e] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.id, c.req.param('id')));
    if (!e) return c.json({ error: 'not_found' }, 404);
    const s = await readableSeries(ctx.db, e.seriesId, c.var.session?.user.id ?? null);
    if (!s) return c.json({ error: 'not_found' }, 404);
    const details = await episodeDetails(ctx.db, [e.id]);
    return c.json({ ...serialiseEpisode(e, details.get(e.id), { transcript: true }), seriesTitle: s.title, isOwner: s.userId === c.var.session?.user.id });
  });

  r.get('/episodes/:id/audio', async (c) => {
    const [e] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.id, c.req.param('id')));
    if (!e || e.status !== 'ready' || !e.audioKey) return c.json({ error: 'not_found' }, 404);
    const s = await readableSeries(ctx.db, e.seriesId, c.var.session?.user.id ?? null);
    if (!s) return c.json({ error: 'not_found' }, 404);
    const cache = s.visibility === 'public' ? 'public, max-age=86400' : 'private, max-age=3600';
    if (ctx.storage.presignGet) {
      c.header('Cache-Control', 'private, no-store');
      return c.redirect(await ctx.storage.presignGet(e.audioKey, 3600), 302);
    }
    const head = await ctx.storage.head(e.audioKey);
    if (!head) return c.json({ error: 'not_found' }, 404);
    const range = parseRange(c.req.header('range'), head.size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
    }
    const obj = await ctx.storage.get(e.audioKey, range ?? undefined);
    const headers: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(obj.size),
      'Cache-Control': cache,
    };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${head.size}`;
    return new Response(Readable.toWeb(obj.stream) as ReadableStream, { status: range ? 206 : 200, headers });
  });

  return r;
}
