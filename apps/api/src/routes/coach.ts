import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { LlmError, ProviderNotConfiguredError, type ChatMessage } from '@thinkmade/ai';
import { getActivePrompts, schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { COACH_INSTRUCTIONS, selectExcerpts } from '../coach/context';
import { rateLimit } from '../middleware/rate-limit';
import { requireVerified, type AppVariables } from '../middleware/session';
import { episodeDetails, readableSeries } from './series';

const messageBody = z.strictObject({ content: z.string().trim().min(1).max(2000) });
const HISTORY = 12;

export function coachRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  async function readable(episodeId: string, userId: string) {
    const [e] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.id, episodeId));
    if (!e) return null;
    const s = await readableSeries(ctx.db, e.seriesId, userId);
    return s ? { episode: e, series: s } : null;
  }

  async function latestSession(userId: string, episodeId: string) {
    const [s] = await ctx.db
      .select()
      .from(schema.coachingSession)
      .where(and(eq(schema.coachingSession.userId, userId), eq(schema.coachingSession.episodeId, episodeId)))
      .orderBy(desc(schema.coachingSession.updatedAt))
      .limit(1);
    return s ?? null;
  }

  r.get('/coach/:episodeId', requireVerified(), async (c) => {
    const userId = c.var.session!.user.id;
    const found = await readable(c.req.param('episodeId'), userId);
    if (!found) return c.json({ error: 'not_found' }, 404);
    const session = await latestSession(userId, found.episode.id);
    const messages = session
      ? await ctx.db
          .select({ id: schema.coachingMessage.id, role: schema.coachingMessage.role, content: schema.coachingMessage.content, createdAt: schema.coachingMessage.createdAt })
          .from(schema.coachingMessage)
          .where(eq(schema.coachingMessage.sessionId, session.id))
          .orderBy(asc(schema.coachingMessage.createdAt), asc(schema.coachingMessage.id))
      : [];
    return c.json({ session: session && { id: session.id }, episode: { id: found.episode.id, title: found.episode.title, seriesTitle: found.series.title }, messages });
  });

  r.post(
    '/coach/:episodeId/messages',
    requireVerified(),
    rateLimit({ db: ctx.db, name: 'coach', key: (c) => (c.var as AppVariables).session!.user.id, limit: 40, windowSeconds: 15 * 60, now: ctx.now }),
    async (c) => {
      const userId = c.var.session!.user.id;
      const parsed = messageBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'invalid_request', message: 'Ask a question of up to 2,000 characters.' }, 400);
      const found = await readable(c.req.param('episodeId'), userId);
      if (!found) return c.json({ error: 'not_found' }, 404);
      const { episode, series } = found;

      let session = await latestSession(userId, episode.id);
      const history = session
        ? (
            await ctx.db
              .select()
              .from(schema.coachingMessage)
              .where(eq(schema.coachingMessage.sessionId, session.id))
              .orderBy(desc(schema.coachingMessage.createdAt), desc(schema.coachingMessage.id))
              .limit(HISTORY)
          ).reverse()
        : [];

      const [request] = await ctx.db.select().from(schema.learningRequest).where(eq(schema.learningRequest.id, series.learningRequestId));
      const details = (await episodeDetails(ctx.db, [episode.id])).get(episode.id);
      const recent = [...history.slice(-2).map((m) => m.content), parsed.data.content].join(' ');
      const excerpts = selectExcerpts(episode.transcript ?? '', recent);
      const context = {
        // Only the owner's original question is shared with the coach; for public episodes we use the episode's own objective.
        originalQuestion: series.userId === userId ? (request?.inputText ?? request?.objective ?? null) : null,
        seriesTitle: series.title,
        episode: { title: episode.title, learningObjective: episode.learningObjective, outcomes: episode.outcomes, keyTakeaways: episode.keyTakeaways, examples: episode.examples },
        mentalModels: details?.models.map((m) => ({ name: m.name, summary: m.summary, role: m.role })) ?? [],
        verifiedBooks: details?.sources.map((s) => s.title) ?? [],
      };
      const instructions = (await getActivePrompts(ctx.db)).get('coach') ?? COACH_INSTRUCTIONS;
      const system = `STAGE: coach\n${instructions}\n\nEpisode context (JSON):\n${JSON.stringify(context, null, 2)}\n\nTranscript excerpts:\n${excerpts.map((x, i) => `[${i + 1}] ${x}`).join('\n\n') || '(none)'}`;
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role === 'coach' ? ('assistant' as const) : ('user' as const), content: m.content })),
        { role: 'user', content: parsed.data.content },
      ];

      let replyText: string;
      let tokens = 0;
      try {
        const llm = await ctx.llm('coach');
        const res = await llm.chat(messages, { temperature: 0.6, maxTokens: 600 });
        replyText = res.content.trim();
        tokens = res.usage.promptTokens + res.usage.completionTokens;
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) {
          return c.json({ error: 'coach_unavailable', message: 'Coaching is not configured on this server yet.' }, 503);
        }
        console.error('[coach] model call failed', err instanceof LlmError ? err.message : err);
        return c.json({ error: 'coach_failed', message: 'The coach could not answer just now. Please try again.' }, 502);
      }
      if (!replyText) return c.json({ error: 'coach_failed', message: 'The coach could not answer just now. Please try again.' }, 502);

      if (!session) {
        const [created] = await ctx.db.insert(schema.coachingSession).values({ userId, episodeId: episode.id, title: parsed.data.content.slice(0, 120) }).returning();
        session = created!;
      }
      const now = Date.now();
      const [userMsg] = await ctx.db.insert(schema.coachingMessage).values({ sessionId: session!.id, role: 'user', content: parsed.data.content, createdAt: new Date(now) }).returning();
      const [reply] = await ctx.db.insert(schema.coachingMessage).values({ sessionId: session!.id, role: 'coach', content: replyText, createdAt: new Date(now + 1) }).returning();
      await ctx.db.update(schema.coachingSession).set({ updatedAt: new Date() }).where(eq(schema.coachingSession.id, session!.id));
      await ctx.db.insert(schema.usageMetric).values({ metric: 'llm_tokens', provider: 'coach', value: tokens, userId });
      return c.json({
        sessionId: session!.id,
        message: { id: userMsg!.id, role: 'user', content: userMsg!.content, createdAt: userMsg!.createdAt },
        reply: { id: reply!.id, role: 'coach', content: reply!.content, createdAt: reply!.createdAt },
      });
    },
  );

  return r;
}
