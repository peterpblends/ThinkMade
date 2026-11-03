import { Hono } from 'hono';
import type { AppContext } from '../create-context';
import { requireFeature } from '../middleware/feature';
import { rateLimit } from '../middleware/rate-limit';
import { requireVerified, type AppVariables } from '../middleware/session';

const MAX_BYTES = 10 * 1024 * 1024;
/** About two minutes of 16 kHz speech. */
const TURN_MAX_BYTES = 4 * 1024 * 1024;

/** Voice input: a short recording in, editable text out. */
export function transcribeRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  r.post(
    '/transcribe',
    requireVerified(),
    requireFeature(ctx, 'voiceInput'),
    rateLimit({ db: ctx.db, name: 'stt', key: (c) => (c.var as AppVariables).session!.user.id, limit: 30, windowSeconds: 15 * 60, now: ctx.now }),
    async (c) => {
      if (!ctx.stt) {
        return c.json({ error: 'stt_unavailable', message: 'Voice transcription is not configured on this server. Please type your question.' }, 503);
      }
      const length = Number(c.req.header('content-length') ?? 0);
      if (length > MAX_BYTES + 10_000) return c.json({ error: 'too_large' }, 413);
      const form = await c.req.formData().catch(() => null);
      const file = form?.get('audio');
      if (!(file instanceof File)) return c.json({ error: 'invalid_request' }, 400);
      if (!/^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)(;.*)?$/.test(file.type)) return c.json({ error: 'unsupported_media_type' }, 415);
      if (file.size > MAX_BYTES) return c.json({ error: 'too_large' }, 413);
      try {
        const { text } = await ctx.stt.transcribe(Buffer.from(await file.arrayBuffer()), { filename: file.name || 'voice', contentType: file.type, language: 'en' });
        return c.json({ text });
      } catch (err) {
        console.error('[stt] transcription failed', err);
        return c.json({ error: 'stt_failed', message: 'We could not transcribe that recording. Please try again or type your question.' }, 502);
      }
    },
  );
  // One spoken turn of a conversation (the coach, or planning a podcast): a short clip, transcribed fast and
  // accurately so the reply answers what was actually said. The allowance fits a conversation's many turns.
  r.post(
    '/transcribe/turn',
    requireVerified(),
    rateLimit({ db: ctx.db, name: 'stt-turn', key: (c) => (c.var as AppVariables).session!.user.id, limit: 240, windowSeconds: 15 * 60, now: ctx.now }),
    async (c) => {
      const { features } = (await ctx.settings.getActive()).settings;
      if (!features.voiceCoaching) return c.json({ error: 'feature_off', feature: 'voiceCoaching' }, 403);
      if (!ctx.stt) return c.json({ error: 'stt_unavailable' }, 503);
      const form = await c.req.formData().catch(() => null);
      const file = form?.get('audio');
      if (!(file instanceof File)) return c.json({ error: 'invalid_request' }, 400);
      if (!/^audio\/(wav|x-wav|webm|ogg|mp4)(;.*)?$/.test(file.type)) return c.json({ error: 'unsupported_media_type' }, 415);
      if (file.size > TURN_MAX_BYTES) return c.json({ error: 'too_large' }, 413);
      const language = String(form?.get('language') ?? 'en').slice(0, 5).toLowerCase().split('-')[0] || 'en';
      const prompt = String(form?.get('prompt') ?? '').slice(0, 600);
      try {
        const { text } = await ctx.stt.transcribe(Buffer.from(await file.arrayBuffer()), { filename: file.name || 'turn.wav', contentType: file.type, language, ...(prompt ? { prompt } : {}), timeoutMs: 8000 });
        return c.json({ text });
      } catch (err) {
        console.error('[stt] turn transcription failed', err instanceof Error ? err.message : err);
        return c.json({ error: 'stt_failed' }, 502);
      }
    },
  );
  return r;
}
