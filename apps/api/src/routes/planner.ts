import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { LlmError, ProviderNotConfiguredError, type ChatMessage } from '@thinkmade/ai';
import { EPISODE_COUNT_CHOICES, LANGUAGES, PLANNER_INSTRUCTIONS, PODCAST_LENGTH_CHOICES, SPOKEN_COACH_INSTRUCTIONS, speaksLanguage, usableVoices, type AppSettings } from '@thinkmade/shared';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { requireFeature } from '../middleware/feature';
import { rateLimit } from '../middleware/rate-limit';
import { requireVerified, type AppVariables } from '../middleware/session';

const plannerBody = z.strictObject({
  /** The conversation so far, oldest first; the last message is the listener's newest. */
  messages: z
    .array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(30),
  /** What the Create form holds now. */
  current: z.strictObject({
    topic: z.string().max(2000),
    episodes: z.number().int(),
    lengthMinutes: z.number().int(),
    speakerFormat: z.enum(['single', 'two_hosts', 'mixed']),
    learningMode: z.enum(['explore', 'deepen', 'reinforce']),
    voiceGender: z.enum(['female', 'male', 'any']).optional(),
    voiceAccent: z.string().max(20).optional(),
    language: z.string().max(10).optional(),
  }),
  /** Said aloud, in the hands-free conversation. */
  spoken: z.boolean().optional(),
});

/** What the planner may change on the form. */
const settingsSchema = z.object({
  brief: z.string().trim().min(1).max(2000).optional(),
  episodes: z.number().optional(),
  lengthMinutes: z.number().optional(),
  speakerFormat: z.enum(['single', 'two_hosts', 'mixed']).optional(),
  learningMode: z.enum(['explore', 'deepen', 'reinforce']).optional(),
  voiceGender: z.enum(['female', 'male', 'any']).optional(),
  voiceAccent: z.enum(['american', 'british', 'latino', 'south-asian', 'east-asian', 'any']).optional(),
  language: z.string().optional(),
  ready: z.boolean().optional(),
});
export type PlannerSettings = z.infer<typeof settingsSchema>;

const MARKER = 'SETTINGS:';

/** The nearest allowed choice. */
const nearest = (n: number, choices: readonly number[]) => choices.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), choices[0]!);

/** What the podcast may be set to, given the administrator's settings. */
function choices(settings: AppSettings) {
  const p = settings.podcast;
  const voices = usableVoices(settings);
  return {
    lengthMinutes: PODCAST_LENGTH_CHOICES.filter((m) => m <= p.maxEpisodeMinutes),
    episodes: EPISODE_COUNT_CHOICES.filter((n) => n <= p.maxEpisodesPerSeries),
    languages: LANGUAGES.filter((l) => l.code === 'en' || (settings.features.languages && voices.some((v) => speaksLanguage(v, l.code)))).map((l) => ({ code: l.code, name: l.name })),
  };
}

/** Reads the settings line at the end of a reply, keeping only valid, allowed values. */
export function parsePlannerSettings(text: string, allowed: { episodes: readonly number[]; lengthMinutes: readonly number[]; languages: ReadonlyArray<{ code: string }> }): PlannerSettings {
  const at = text.lastIndexOf(MARKER);
  if (at < 0) return {};
  const raw = text.slice(at + MARKER.length).trim();
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  const r = settingsSchema.safeParse(parsed);
  if (!r.success) return {};
  const out: PlannerSettings = { ...r.data };
  if (out.episodes !== undefined) out.episodes = nearest(out.episodes, allowed.episodes);
  if (out.lengthMinutes !== undefined) out.lengthMinutes = nearest(out.lengthMinutes, allowed.lengthMinutes);
  if (out.language !== undefined && !allowed.languages.some((l) => l.code === out.language)) delete out.language;
  return out;
}

/**
 * Plan a podcast by conversation: the planner asks clarifying questions, writes the brief and sets the
 * podcast up. Its reply streams in (and is spoken, in the hands-free conversation); the settings come at the end.
 */
export function plannerRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  r.post(
    '/planner',
    requireVerified(),
    requireFeature(ctx, 'planner'),
    rateLimit({ db: ctx.db, name: 'planner', key: (c) => (c.var as AppVariables).session!.user.id, limit: 120, windowSeconds: 15 * 60, now: ctx.now }),
    async (c) => {
      const parsed = plannerBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || parsed.data.messages.at(-1)!.role !== 'user') return c.json({ error: 'invalid_request', message: 'Say what you would like the podcast to help with.' }, 400);
      const { settings } = await ctx.settings.getActive();
      if (parsed.data.spoken && !settings.features.voiceCoaching) {
        return c.json({ error: 'feature_off', feature: 'voiceCoaching', message: 'Talking hands-free is turned off right now. You can still type.' }, 403);
      }
      const allowed = choices(settings);
      const system = `STAGE: planner\n${PLANNER_INSTRUCTIONS}${parsed.data.spoken ? `\n\n${SPOKEN_COACH_INSTRUCTIONS}` : ''}\n\nchoices (JSON): ${JSON.stringify({ ...allowed, voiceAccents: ['american', 'british', 'latino', 'south-asian', 'east-asian'] })}\n\nThe Create form now (JSON): ${JSON.stringify(parsed.data.current)}`;
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...parsed.data.messages];
      const options = { temperature: 0.6, maxTokens: 600 };
      const failure = (err: unknown) => {
        if (err instanceof ProviderNotConfiguredError) return { status: 503 as const, body: { error: 'planner_unavailable', message: 'Planning by conversation is not configured on this server yet.' } };
        console.error('[planner] model call failed', err instanceof LlmError ? err.message : err);
        return { status: 502 as const, body: { error: 'planner_failed', message: 'The planner could not answer just now. Please try again.' } };
      };
      /** The visible reply: everything before the settings line. */
      const visible = (text: string) => {
        const at = text.lastIndexOf(MARKER);
        return (at >= 0 ? text.slice(0, at) : text).trim();
      };
      const result = async (text: string, tokens: number) => {
        await ctx.db.insert(schema.usageMetric).values({ metric: 'llm_tokens', provider: 'planner', value: tokens, userId: c.var.session!.user.id });
        return { reply: visible(text) || 'Tell me a bit more about what you would like to think through.', settings: parsePlannerSettings(text, allowed) };
      };

      if (c.req.header('accept')?.includes('text/event-stream')) {
        return streamSSE(c, async (stream) => {
          const abort = new AbortController();
          stream.onAbort(() => abort.abort());
          let full = '';
          let sent = 0;
          try {
            const llm = await ctx.llm('coach');
            const res = await llm.chat(messages, {
              ...options,
              signal: abort.signal,
              onToken: (piece) => {
                full += piece;
                // Hold back anything that could be the start of the settings line.
                const at = full.indexOf(MARKER);
                const upTo = at >= 0 ? at : Math.max(sent, full.length - MARKER.length);
                if (upTo > sent) {
                  const text = full.slice(sent, upTo);
                  sent = upTo;
                  void stream.writeSSE({ event: 'delta', data: JSON.stringify({ text }) });
                }
              },
            });
            await stream.writeSSE({ event: 'done', data: JSON.stringify(await result(res.content, res.usage.promptTokens + res.usage.completionTokens)) });
          } catch (err) {
            if (abort.signal.aborted) return;
            await stream.writeSSE({ event: 'error', data: JSON.stringify(failure(err).body) });
          }
        });
      }
      try {
        const llm = await ctx.llm('coach');
        const res = await llm.chat(messages, options);
        return c.json(await result(res.content, res.usage.promptTokens + res.usage.completionTokens));
      } catch (err) {
        const f = failure(err);
        return c.json(f.body, f.status);
      }
    },
  );
  return r;
}
