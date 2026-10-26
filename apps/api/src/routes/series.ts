import { Readable } from 'node:stream';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema, type Db } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { z } from 'zod';
import { FollowUpError, startFollowUp, type FollowUp } from '../generation/follow-up';
import { requireSession, requireVerified, type AppVariables } from '../middleware/session';
import { dailyLimitMessage } from './generation';

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
  if (!m || (!m[1] && !m[2])) return 'invalid';
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
        // Episodes a reviewer rejected are never shown to the listener.
        episodeCount: sql<number>`(select count(*)::int from episode e where e.series_id = "podcast_series"."id" and e.status <> 'rejected')`,
        readyCount: sql<number>`(select count(*)::int from episode e where e.series_id = "podcast_series"."id" and e.status = 'ready')`,
        totalSeconds: sql<number>`(select coalesce(sum(e.duration_seconds), 0)::float from episode e where e.series_id = "podcast_series"."id" and e.status = 'ready')`,
      })
      .from(schema.podcastSeries)
      .where(
        and(
          eq(schema.podcastSeries.userId, userId),
          // A series whose every episode was rejected has nothing to show.
          // Parenthesised so the OR never escapes the owner condition above.
          sql`(not exists (select 1 from episode e where e.series_id = "podcast_series"."id" and e.status = 'rejected')
              or exists (select 1 from episode e where e.series_id = "podcast_series"."id" and e.status <> 'rejected'))`,
        ),
      )
      .orderBy(desc(schema.podcastSeries.createdAt));
    return c.json({ series: rows });
  });

  r.get('/series/:id', async (c) => {
    const s = await readableSeries(ctx.db, c.req.param('id'), c.var.session?.user.id ?? null);
    if (!s) return c.json({ error: 'not_found' }, 404);
    const isOwner = s.userId === c.var.session?.user.id;
    // Other people only see finished episodes of a public series.
    // Rejected episodes are hidden from everyone.
    const eps = (await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, s.id)).orderBy(schema.episode.number)).filter((e) => (isOwner ? e.status !== 'rejected' : e.status === 'ready'));
    const details = await episodeDetails(ctx.db, eps.map((e) => e.id));
    const owner = isOwner
      ? {
          // Episodes a reviewer removed: only their place in the series is shown, so the owner can replace them.
          removedEpisodes: (await ctx.db.select({ id: schema.episode.id, number: schema.episode.number }).from(schema.episode).where(and(eq(schema.episode.seriesId, s.id), eq(schema.episode.status, 'rejected')))).sort((a, b) => a.number - b.number),
          activeGenerationId:
            (
              await ctx.db
                .select({ id: schema.generationJob.id })
                .from(schema.generationJob)
                .where(and(eq(schema.generationJob.seriesId, s.id), inArray(schema.generationJob.status, ['queued', 'running'])))
                .limit(1)
            )[0]?.id ?? null,
          maxEpisodes: (await ctx.settings.getActive()).settings.podcast.maxEpisodesPerSeries,
        }
      : {};
    return c.json({
      ...owner,
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

  const followUp = async (c: { var: AppVariables; json: (b: unknown, s?: number) => Response }, seriesId: string, req: FollowUp) => {
    try {
      return c.json({ id: await startFollowUp(ctx, seriesId, c.var.session!.user.id, req), status: 'queued' }, 202);
    } catch (err) {
      if (err instanceof FollowUpError) return c.json({ error: err.code, message: err.message }, err.status);
      throw err;
    }
  };

  // More episodes at the end of an existing series.
  r.post('/series/:id/episodes', requireVerified(), async (c) => {
    const body = z.strictObject({ count: z.number().int().min(1).max(20) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', message: 'Choose how many episodes to add.' }, 400);
    const { settings } = await ctx.settings.getActive();
    const limited = await dailyLimitMessage(ctx, c.var.session!.user, settings.limits.perUserDailyJobs);
    if (limited) return c.json({ error: 'daily_limit', message: limited }, 429);
    return followUp(c, c.req.param('id'), { kind: 'extend', count: body.data.count });
  });

  // A new episode in place of one a reviewer rejected.
  r.post('/series/:id/episodes/:episodeId/replace', requireVerified(), (c) => followUp(c, c.req.param('id'), { kind: 'replace', episodeId: c.req.param('episodeId') }));

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
