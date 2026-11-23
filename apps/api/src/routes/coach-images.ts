import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { ImageUnavailableError } from '@thinkmade/ai';
import type { AppContext } from '../create-context';
import { requireFeature } from '../middleware/feature';
import { rateLimit } from '../middleware/rate-limit';
import { requireSession, requireVerified, type AppVariables } from '../middleware/session';
import { requireTerms } from '../terms';

const bodySchema = z.object({ prompt: z.string().trim().min(3).max(600) });
const keyOf = (prompt: string) => createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex').slice(0, 40);
const path = (key: string) => `coach-images/${key}.png`;

/**
 * Pictures the coach draws: made once per description with the image model, kept in storage, and served to
 * signed-in listeners. Without an image model (or allowance) the app shows the picture's description instead.
 */
export function coachImageRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  r.post(
    '/coach/images',
    requireVerified(),
    requireTerms(ctx.db),
    requireFeature(ctx, 'coach'),
    rateLimit({ db: ctx.db, name: 'coach-image', key: (c) => (c.var as AppVariables).session!.user.id, limit: 20, windowSeconds: 60 * 60, now: ctx.now }),
    async (c) => {
      const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const key = keyOf(parsed.data.prompt);
      if (await ctx.storage.head(path(key))) return c.json({ url: `/api/coach/images/${key}` });
      if (!ctx.images) return c.json({ error: 'image_unavailable', message: 'Pictures are not set up on this server.' }, 503);
      try {
        const img = await ctx.images.generate(parsed.data.prompt);
        await ctx.storage.put(path(key), img.bytes, img.mimeType);
        return c.json({ url: `/api/coach/images/${key}` });
      } catch (err) {
        if (err instanceof ImageUnavailableError) return c.json({ error: 'image_unavailable', message: 'Pictures are not available right now.' }, 503);
        console.error('[coach-image] generation failed', err instanceof Error ? err.message : err);
        return c.json({ error: 'image_failed', message: 'The picture could not be drawn just now.' }, 502);
      }
    },
  );
  r.get('/coach/images/:key{[a-f0-9]{40}}', requireSession(), async (c) => {
    const key = c.req.param('key');
    const head = await ctx.storage.head(path(key));
    if (!head) return c.json({ error: 'not_found' }, 404);
    const obj = await ctx.storage.get(path(key));
    return new Response(Readable.toWeb(obj.stream) as ReadableStream, { headers: { 'content-type': head.contentType || 'image/png', 'cache-control': 'private, max-age=31536000, immutable' } });
  });
  return r;
}
