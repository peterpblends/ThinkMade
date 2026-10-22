import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { requireSession, type AppVariables } from '../middleware/session';

/** Account self-service that Better Auth does not cover. */
export function accountRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  /** Everything ThinkMade stores about the signed-in user, as a downloadable JSON file. */
  r.get('/me/export', requireSession(), async (c) => {
    const userId = c.var.session!.user.id;
    const db = ctx.db;
    const [user] = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        emailVerified: schema.user.emailVerified,
        createdAt: schema.user.createdAt,
        twoFactorEnabled: schema.user.twoFactorEnabled,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const passkeys = await db
      .select({ name: schema.passkey.name, createdAt: schema.passkey.createdAt, deviceType: schema.passkey.deviceType })
      .from(schema.passkey)
      .where(eq(schema.passkey.userId, userId));
    const learningRequests = await db.select().from(schema.learningRequest).where(eq(schema.learningRequest.userId, userId));
    const series = await db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.userId, userId));
    const seriesIds = series.map((s) => s.id);
    const episodes = seriesIds.length
      ? await db.select().from(schema.episode).where(inArray(schema.episode.seriesId, seriesIds))
      : [];
    const coachingSessions = await db.select().from(schema.coachingSession).where(eq(schema.coachingSession.userId, userId));
    const sessionIds = coachingSessions.map((s) => s.id);
    const coachingMessages = sessionIds.length
      ? await db.select().from(schema.coachingMessage).where(inArray(schema.coachingMessage.sessionId, sessionIds))
      : [];
    const [playback, favorites, ratings, library, uploads] = await Promise.all([
      db.select().from(schema.playbackState).where(eq(schema.playbackState.userId, userId)),
      db.select().from(schema.favorite).where(eq(schema.favorite.userId, userId)),
      db.select().from(schema.rating).where(eq(schema.rating.userId, userId)),
      db.select().from(schema.libraryItem).where(eq(schema.libraryItem.userId, userId)),
      db
        .select({ id: schema.mediaUpload.id, kind: schema.mediaUpload.kind, createdAt: schema.mediaUpload.createdAt })
        .from(schema.mediaUpload)
        .where(eq(schema.mediaUpload.userId, userId)),
    ]);
    const exportedAt = ctx.now();
    const payload = {
      format: 'thinkmade-export@1',
      exportedAt: exportedAt.toISOString(),
      user,
      passkeys,
      learningRequests,
      podcastSeries: series,
      episodes,
      coachingSessions,
      coachingMessages,
      playback,
      favorites,
      ratings,
      library,
      uploads,
    };
    c.header('Content-Disposition', `attachment; filename="thinkmade-export-${exportedAt.toISOString().slice(0, 10)}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(payload);
  });

  return r;
}
