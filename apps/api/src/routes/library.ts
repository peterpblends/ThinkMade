import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '@thinkmade/db';
import { applyPlaybackEvent, playbackEventSchema, type ListenStatus, type PlaybackRecord } from '@thinkmade/shared';
import type { AppContext } from '../create-context';
import { requireSession, type AppVariables } from '../middleware/session';
import { readableSeries } from './series';
import { indexSeries } from './discover';

/** Episode the user may see (own or public), or null. */
async function readableEpisode(ctx: AppContext, episodeId: string, userId: string) {
  const [e] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.id, episodeId));
  if (!e) return null;
  const s = await readableSeries(ctx.db, e.seriesId, userId);
  return s ? { episode: e, series: s } : null;
}

function slugify(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'series';
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

const SORTS = { recent: 'recent', title: 'title', duration: 'duration', series: 'series' } as const;

export function libraryRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  const auth = requireSession();

  r.put('/playback/:episodeId', auth, async (c) => {
    const userId = c.var.session!.user.id;
    const parsed = playbackEventSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const found = await readableEpisode(ctx, c.req.param('episodeId'), userId);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const { settings } = await ctx.settings.getActive();
    const result = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.playbackState)
        .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.episodeId, found.episode.id)))
        .for('update');
      const current: PlaybackRecord | null = row
        ? { positionMs: row.positionMs, status: row.status as ListenStatus, manualStatus: row.manualStatus, clientUpdatedAt: row.clientUpdatedAt?.toISOString() ?? null, deviceId: row.deviceId }
        : null;
      const durationMs = found.episode.durationSeconds ? Math.round(found.episode.durationSeconds * 1000) : null;
      const { next, applied } = applyPlaybackEvent(current, parsed.data, durationMs, settings.player.completionThreshold);
      if (applied) {
        const values = { positionMs: next.positionMs, status: next.status, manualStatus: next.manualStatus, deviceId: next.deviceId, clientUpdatedAt: next.clientUpdatedAt ? new Date(next.clientUpdatedAt) : null, updatedAt: new Date() };
        await tx
          .insert(schema.playbackState)
          .values({ userId, episodeId: found.episode.id, ...values })
          .onConflictDoUpdate({ target: [schema.playbackState.userId, schema.playbackState.episodeId], set: values });
      }
      return { ...next, applied };
    });
    return c.json(result);
  });

  r.get('/playback/:episodeId', auth, async (c) => {
    const userId = c.var.session!.user.id;
    const found = await readableEpisode(ctx, c.req.param('episodeId'), userId);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const [row] = await ctx.db
      .select()
      .from(schema.playbackState)
      .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.episodeId, found.episode.id)));
    const [fav] = await ctx.db.select().from(schema.favorite).where(and(eq(schema.favorite.userId, userId), eq(schema.favorite.episodeId, found.episode.id)));
    const [rat] = await ctx.db.select().from(schema.rating).where(and(eq(schema.rating.userId, userId), eq(schema.rating.episodeId, found.episode.id)));
    return c.json({
      positionMs: row?.positionMs ?? 0,
      status: row?.status ?? 'not_started',
      clientUpdatedAt: row?.clientUpdatedAt ?? null,
      favorite: Boolean(fav),
      rating: rat?.stars ?? null,
    });
  });

  r.put('/favorites/:episodeId', auth, async (c) => {
    const found = await readableEpisode(ctx, c.req.param('episodeId'), c.var.session!.user.id);
    if (!found) return c.json({ error: 'not_found' }, 404);
    await ctx.db.insert(schema.favorite).values({ userId: c.var.session!.user.id, episodeId: found.episode.id }).onConflictDoNothing();
    return c.json({ favorite: true });
  });

  r.delete('/favorites/:episodeId', auth, async (c) => {
    await ctx.db.delete(schema.favorite).where(and(eq(schema.favorite.userId, c.var.session!.user.id), eq(schema.favorite.episodeId, c.req.param('episodeId'))));
    return c.json({ favorite: false });
  });

  r.put('/ratings/:episodeId', auth, async (c) => {
    const body = z.strictObject({ stars: z.number().int().min(1).max(5) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request', message: 'Ratings are 1 to 5 stars.' }, 400);
    const found = await readableEpisode(ctx, c.req.param('episodeId'), c.var.session!.user.id);
    if (!found) return c.json({ error: 'not_found' }, 404);
    await ctx.db
      .insert(schema.rating)
      .values({ userId: c.var.session!.user.id, episodeId: found.episode.id, stars: body.data.stars })
      .onConflictDoUpdate({ target: [schema.rating.userId, schema.rating.episodeId], set: { stars: body.data.stars, updatedAt: new Date() } });
    return c.json({ stars: body.data.stars });
  });

  r.delete('/ratings/:episodeId', auth, async (c) => {
    await ctx.db.delete(schema.rating).where(and(eq(schema.rating.userId, c.var.session!.user.id), eq(schema.rating.episodeId, c.req.param('episodeId'))));
    return c.json({ stars: null });
  });

  /** Everything the library screen needs, with optional search, model filter and sort. */
  r.get('/library', auth, async (c) => {
    const userId = c.var.session!.user.id;
    const q = c.req.query('q')?.trim().slice(0, 100);
    const model = c.req.query('model');
    const sort = SORTS[(c.req.query('sort') ?? 'recent') as keyof typeof SORTS] ?? 'recent';

    // Series in the library: owned, plus public series the user saved.
    const owned = ctx.db.select({ id: schema.podcastSeries.id }).from(schema.podcastSeries).where(eq(schema.podcastSeries.userId, userId));
    const saved = ctx.db
      .select({ id: schema.libraryItem.seriesId })
      .from(schema.libraryItem)
      .innerJoin(schema.podcastSeries, eq(schema.podcastSeries.id, schema.libraryItem.seriesId))
      .where(and(eq(schema.libraryItem.userId, userId), or(eq(schema.podcastSeries.userId, userId), eq(schema.podcastSeries.visibility, 'public'))));
    const seriesIds = [...new Set([...(await owned).map((x) => x.id), ...(await saved).map((x) => x.id)])];
    if (!seriesIds.length) return c.json({ episodes: [], continueListening: [], completed: [], favorites: [], models: [] });

    const conditions = [inArray(schema.episode.seriesId, seriesIds), eq(schema.episode.status, 'ready')];
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conditions.push(
        or(
          ilike(schema.episode.title, like),
          ilike(schema.episode.description, like),
          ilike(schema.podcastSeries.title, like),
          sql`exists (select 1 from episode_mental_model em join mental_model m on m.id = em.mental_model_id where em.episode_id = ${schema.episode.id} and m.name ilike ${like})`,
        )!,
      );
    }
    if (model) {
      conditions.push(sql`exists (select 1 from episode_mental_model em join mental_model m on m.id = em.mental_model_id where em.episode_id = ${schema.episode.id} and m.slug = ${model})`);
    }
    const rows = await ctx.db
      .select({
        id: schema.episode.id,
        seriesId: schema.episode.seriesId,
        seriesTitle: schema.podcastSeries.title,
        number: schema.episode.number,
        title: schema.episode.title,
        description: schema.episode.description,
        durationSeconds: schema.episode.durationSeconds,
        createdAt: schema.episode.createdAt,
        positionMs: schema.playbackState.positionMs,
        listenStatus: schema.playbackState.status,
        lastPlayedAt: schema.playbackState.updatedAt,
        favorite: sql<boolean>`${schema.favorite.episodeId} is not null`,
        rating: schema.rating.stars,
        primaryModelName: schema.mentalModel.name,
        primaryModelSlug: schema.mentalModel.slug,
      })
      .from(schema.episode)
      .innerJoin(schema.podcastSeries, eq(schema.podcastSeries.id, schema.episode.seriesId))
      .leftJoin(schema.mentalModel, eq(schema.mentalModel.id, schema.episode.primaryMentalModelId))
      .leftJoin(schema.playbackState, and(eq(schema.playbackState.episodeId, schema.episode.id), eq(schema.playbackState.userId, userId)))
      .leftJoin(schema.favorite, and(eq(schema.favorite.episodeId, schema.episode.id), eq(schema.favorite.userId, userId)))
      .leftJoin(schema.rating, and(eq(schema.rating.episodeId, schema.episode.id), eq(schema.rating.userId, userId)))
      .where(and(...conditions))
      .orderBy(
        ...(sort === 'title'
          ? [schema.episode.title]
          : sort === 'duration'
            ? [desc(schema.episode.durationSeconds)]
            : sort === 'series'
              ? [schema.podcastSeries.title, schema.episode.number]
              : [desc(sql`coalesce(${schema.playbackState.updatedAt}, ${schema.episode.createdAt})`)]),
      );
    const episodes = rows.map((e) => ({
      id: e.id,
      seriesId: e.seriesId,
      seriesTitle: e.seriesTitle,
      number: e.number,
      title: e.title,
      description: e.description,
      durationSeconds: e.durationSeconds,
      positionMs: e.positionMs ?? 0,
      listenStatus: (e.listenStatus ?? 'not_started') as ListenStatus,
      lastPlayedAt: e.lastPlayedAt,
      favorite: Boolean(e.favorite),
      rating: e.rating ?? null,
      primaryModel: e.primaryModelSlug ? { slug: e.primaryModelSlug, name: e.primaryModelName } : null,
      audioUrl: `/api/episodes/${e.id}/audio`,
    }));
    const models = [...new Map(episodes.filter((e) => e.primaryModel).map((e) => [e.primaryModel!.slug, e.primaryModel!])).values()];
    return c.json({
      episodes,
      continueListening: episodes
        .filter((e) => e.listenStatus === 'in_progress')
        .sort((a, b) => new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime()),
      completed: episodes.filter((e) => e.listenStatus === 'completed'),
      favorites: episodes.filter((e) => e.favorite),
      models,
    });
  });

  /** Save a public series (or re-add your own) to the library. */
  r.put('/library/:seriesId', auth, async (c) => {
    const s = await readableSeries(ctx.db, c.req.param('seriesId'), c.var.session!.user.id);
    if (!s) return c.json({ error: 'not_found' }, 404);
    await ctx.db.insert(schema.libraryItem).values({ userId: c.var.session!.user.id, seriesId: s.id }).onConflictDoNothing();
    return c.json({ saved: true });
  });

  r.delete('/library/:seriesId', auth, async (c) => {
    await ctx.db.delete(schema.libraryItem).where(and(eq(schema.libraryItem.userId, c.var.session!.user.id), eq(schema.libraryItem.seriesId, c.req.param('seriesId'))));
    return c.json({ saved: false });
  });

  r.patch('/series/:id', auth, async (c) => {
    const body = z.strictObject({ visibility: z.enum(['private', 'public']) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    const [s] = await ctx.db.select().from(schema.podcastSeries).where(and(eq(schema.podcastSeries.id, c.req.param('id')), eq(schema.podcastSeries.userId, c.var.session!.user.id)));
    if (!s) return c.json({ error: 'not_found' }, 404);
    if (body.data.visibility === 'public' && s.status !== 'ready' && s.status !== 'partial') {
      return c.json({ error: 'not_ready', message: 'Only finished podcasts can be shared.' }, 400);
    }
    const publicSlug = body.data.visibility === 'public' ? (s.publicSlug ?? slugify(s.title)) : s.publicSlug;
    const [updated] = await ctx.db
      .update(schema.podcastSeries)
      .set({ visibility: body.data.visibility, publicSlug })
      .where(eq(schema.podcastSeries.id, s.id))
      .returning({ id: schema.podcastSeries.id, visibility: schema.podcastSeries.visibility, publicSlug: schema.podcastSeries.publicSlug });
    // Indexing for search is best-effort; the visibility change itself has already succeeded.
    if (body.data.visibility === 'public') await indexSeries(ctx, s.id).catch((err) => console.error('[discover] indexing failed', err instanceof Error ? err.message : err));
    await ctx.db.insert(schema.auditLog).values({ actorId: c.var.session!.user.id, action: 'series.visibility', targetType: 'podcast_series', targetId: s.id, before: { visibility: s.visibility }, after: { visibility: body.data.visibility } });
    return c.json(updated);
  });

  r.delete('/series/:id', auth, async (c) => {
    const [s] = await ctx.db.select().from(schema.podcastSeries).where(and(eq(schema.podcastSeries.id, c.req.param('id')), eq(schema.podcastSeries.userId, c.var.session!.user.id)));
    if (!s) return c.json({ error: 'not_found' }, 404);
    const eps = await ctx.db.select({ key: schema.episode.audioKey }).from(schema.episode).where(eq(schema.episode.seriesId, s.id));
    for (const e of eps) if (e.key) await ctx.storage.delete(e.key).catch(() => {});
    await ctx.db.delete(schema.podcastSeries).where(eq(schema.podcastSeries.id, s.id));
    return c.json({ deleted: true });
  });

  return r;
}
