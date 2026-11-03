import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { LlmError, ProviderNotConfiguredError, type ChatMessage } from '@thinkmade/ai';
import { getActivePrompts, schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { languageInfo, languageInstruction, PRACTICE_COACH_INSTRUCTIONS, SPOKEN_COACH_INSTRUCTIONS } from '@thinkmade/shared';
import { COACH_INSTRUCTIONS, selectExcerpts } from '../coach/context';
import { requireFeature } from '../middleware/feature';
import { rateLimit } from '../middleware/rate-limit';
import { requireVerified, type AppVariables } from '../middleware/session';
import { episodeDetails, readableSeries } from './series';

const messageBody = z.strictObject({
  content: z.string().trim().min(1).max(2000),
  /** Said aloud in the hands-free conversation: the coach answers briefly, to be spoken. */
  spoken: z.boolean().optional(),
  /** The listener cut the coach off after it had said this much of its last reply. */
  interruptedAfter: z.string().trim().max(2000).optional(),
});
const HISTORY = 12;

export function coachRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  async function readable(episodeId: string, userId: string) {
    const [e] = await ctx.db.select().from(schema.episode).where(eq(schema.episode.id, episodeId));
    if (!e) return null;
    const s = await readableSeries(ctx.db, e.seriesId, userId);
    return s ? { episode: e, series: s } : null;
  }

  /** The language the series is shown in now (its owner can switch it). */
  async function seriesLanguage(seriesId: string): Promise<string> {
    const [s] = await ctx.db.select({ language: schema.podcastSeries.language }).from(schema.podcastSeries).where(eq(schema.podcastSeries.id, seriesId));
    return languageInfo(s?.language).code;
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

  r.get('/coach/:episodeId', requireVerified(), requireFeature(ctx, 'coach'), async (c) => {
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
    const language = await seriesLanguage(found.series.id);
    return c.json({ session: session && { id: session.id }, episode: { id: found.episode.id, title: found.episode.title, seriesId: found.series.id, seriesTitle: found.series.title }, language, speechLang: languageInfo(language).speech, messages });
  });

  r.post(
    '/coach/:episodeId/messages',
    requireVerified(),
    requireFeature(ctx, 'coach'),
    // A spoken conversation takes many short turns, so the allowance is generous.
    rateLimit({ db: ctx.db, name: 'coach', key: (c) => (c.var as AppVariables).session!.user.id, limit: 120, windowSeconds: 15 * 60, now: ctx.now }),
    async (c) => {
      const userId = c.var.session!.user.id;
      const parsed = messageBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'invalid_request', message: 'Ask a question of up to 2,000 characters.' }, 400);
      const spoken = parsed.data.spoken === true;
      if (spoken && !(await ctx.settings.getActive()).settings.features.voiceCoaching) {
        return c.json({ error: 'feature_off', feature: 'voiceCoaching', message: 'Talking with your coach is turned off right now. You can still type.' }, 403);
      }
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
      const languageRule = languageInstruction(await seriesLanguage(series.id));
      const system = `STAGE: coach\n${instructions}\n\n${PRACTICE_COACH_INSTRUCTIONS}${spoken ? `\n\n${SPOKEN_COACH_INSTRUCTIONS}` : ''}${languageRule ? `\n\n${languageRule} Reply in that language unless the listener writes in another.` : ''}\n\nEpisode context (JSON):\n${JSON.stringify(context, null, 2)}\n\nTranscript excerpts:\n${excerpts.map((x, i) => `[${i + 1}] ${x}`).join('\n\n') || '(none)'}`;
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role === 'coach' ? ('assistant' as const) : ('user' as const), content: m.content })),
        {
          role: 'user',
          content: parsed.data.interruptedAfter
            ? `(I interrupted you after you said: "${parsed.data.interruptedAfter.slice(-300)}")\n\n${parsed.data.content}`
            : parsed.data.content,
        },
      ];

      const options = spoken ? { temperature: 0.7, maxTokens: 400 } : { temperature: 0.6, maxTokens: 700 };
      const failure = (err: unknown) => {
        if (err instanceof ProviderNotConfiguredError) return { status: 503 as const, body: { error: 'coach_unavailable', message: 'Coaching is not configured on this server yet.' } };
        console.error('[coach] model call failed', err instanceof LlmError ? err.message : err);
        return { status: 502 as const, body: { error: 'coach_failed', message: 'The coach could not answer just now. Please try again.' } };
      };
      /** Saves the question and the reply, and returns them as the app shows them. */
      const save = async (replyText: string, tokens: number) => {
        if (!session) {
          const [created] = await ctx.db.insert(schema.coachingSession).values({ userId, episodeId: episode.id, title: parsed.data.content.slice(0, 120) }).returning();
          session = created!;
        }
        const now = Date.now();
        const [userMsg] = await ctx.db.insert(schema.coachingMessage).values({ sessionId: session!.id, role: 'user', content: parsed.data.content, createdAt: new Date(now) }).returning();
        const [reply] = await ctx.db.insert(schema.coachingMessage).values({ sessionId: session!.id, role: 'coach', content: replyText, createdAt: new Date(now + 1) }).returning();
        await ctx.db.update(schema.coachingSession).set({ updatedAt: new Date() }).where(eq(schema.coachingSession.id, session!.id));
        await ctx.db.insert(schema.usageMetric).values({ metric: 'llm_tokens', provider: 'coach', value: tokens, userId });
        return {
          sessionId: session!.id,
          message: { id: userMsg!.id, role: 'user', content: userMsg!.content, createdAt: userMsg!.createdAt },
          reply: { id: reply!.id, role: 'coach', content: reply!.content, createdAt: reply!.createdAt },
        };
      };

      // Streamed: the reply appears (and is spoken) as the model writes it, the way a chat assistant answers.
      if (c.req.header('accept')?.includes('text/event-stream')) {
        return streamSSE(c, async (stream) => {
          const abort = new AbortController();
          stream.onAbort(() => abort.abort());
          try {
            const llm = await ctx.llm('coach');
            const res = await llm.chat(messages, { ...options, signal: abort.signal, onToken: (text) => void stream.writeSSE({ event: 'delta', data: JSON.stringify({ text }) }) });
            const replyText = res.content.trim();
            if (!replyText) throw new LlmError('The coach returned an empty reply');
            await stream.writeSSE({ event: 'done', data: JSON.stringify(await save(replyText, res.usage.promptTokens + res.usage.completionTokens)) });
          } catch (err) {
            if (abort.signal.aborted) return;
            await stream.writeSSE({ event: 'error', data: JSON.stringify(failure(err).body) });
          }
        });
      }

      let replyText: string;
      let tokens = 0;
      try {
        const llm = await ctx.llm('coach');
        const res = await llm.chat(messages, options);
        replyText = res.content.trim();
        tokens = res.usage.promptTokens + res.usage.completionTokens;
      } catch (err) {
        const f = failure(err);
        return c.json(f.body, f.status);
      }
      if (!replyText) return c.json({ error: 'coach_failed', message: 'The coach could not answer just now. Please try again.' }, 502);
      return c.json(await save(replyText, tokens));
    },
  );

  return r;
}
