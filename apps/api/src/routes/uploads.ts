import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { sniffMediaType } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { requireFeature } from '../middleware/feature';
import { rateLimit } from '../middleware/rate-limit';
import { requireVerified, type AppVariables } from '../middleware/session';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const presignBody = z.strictObject({ kind: z.enum(['image', 'video']), contentType: z.string().refine((t) => t in EXT, 'Unsupported type'), size: z.number().int().positive() });

/** Photos and videos for a question. Private, validated by content, and deleted after the retention period. */
export function uploadRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  const limiter = rateLimit({ db: ctx.db, name: 'upload', key: (c) => (c.var as AppVariables).session!.user.id, limit: 60, windowSeconds: 15 * 60, now: ctx.now });

  const limits = async () => (await ctx.settings.getActive()).settings.media;
  const expiry = (days: number) => new Date(ctx.now().getTime() + days * 86400_000);

  // Direct upload through the API (local storage, or small files).
  r.post('/uploads', requireVerified(), requireFeature(ctx, 'mediaUploads'), limiter, async (c) => {
    const media = await limits();
    const maxAny = Math.max(media.maxImageBytes, media.maxVideoBytes);
    if (Number(c.req.header('content-length') ?? 0) > maxAny + 64_000) return c.json({ error: 'too_large' }, 413);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return c.json({ error: 'invalid_request' }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMediaType(bytes);
    if (!sniffed) return c.json({ error: 'unsupported_media_type', message: 'Please choose a photo (JPEG, PNG, WebP, HEIC) or a video (MP4, MOV, WebM).' }, 415);
    const max = sniffed.kind === 'image' ? media.maxImageBytes : media.maxVideoBytes;
    if (bytes.length > max) return c.json({ error: 'too_large', message: `That ${sniffed.kind} is larger than the ${Math.round(max / 1048576)} MB limit.` }, 413);
    const userId = c.var.session!.user.id;
    const id = crypto.randomUUID();
    const key = `uploads/${userId}/${id}.${EXT[sniffed.mime]}`;
    await ctx.storage.put(key, bytes, sniffed.mime);
    await ctx.db.insert(schema.mediaUpload).values({ id, userId, kind: sniffed.kind, objectKey: key, contentType: sniffed.mime, bytes: bytes.length, status: 'uploaded', retentionExpiresAt: expiry(media.retentionDays) });
    return c.json({ id, kind: sniffed.kind }, 201);
  });

  // Presigned direct-to-storage upload for large files (needed on Vercel, which caps request bodies).
  r.post('/uploads/presign', requireVerified(), requireFeature(ctx, 'mediaUploads'), limiter, async (c) => {
    if (!ctx.storage.presignPut) return c.json({ error: 'use_direct_upload' }, 400);
    const parsed = presignBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const media = await limits();
    const max = parsed.data.kind === 'image' ? media.maxImageBytes : media.maxVideoBytes;
    if (parsed.data.size > max) return c.json({ error: 'too_large' }, 413);
    const userId = c.var.session!.user.id;
    const id = crypto.randomUUID();
    const key = `uploads/${userId}/${id}.${EXT[parsed.data.contentType]}`;
    const url = await ctx.storage.presignPut(key, parsed.data.contentType, parsed.data.size, 600);
    await ctx.db.insert(schema.mediaUpload).values({ id, userId, kind: parsed.data.kind, objectKey: key, contentType: parsed.data.contentType, bytes: parsed.data.size, status: 'pending', retentionExpiresAt: expiry(media.retentionDays) });
    return c.json({ id, url, headers: { 'content-type': parsed.data.contentType } });
  });

  r.post('/uploads/:id/complete', requireVerified(), async (c) => {
    const [row] = await ctx.db.select().from(schema.mediaUpload).where(and(eq(schema.mediaUpload.id, c.req.param('id')), eq(schema.mediaUpload.userId, c.var.session!.user.id)));
    if (!row || row.status !== 'pending') return c.json({ error: 'not_found' }, 404);
    const head = await ctx.storage.head(row.objectKey);
    if (!head || head.size > (row.bytes ?? 0)) {
      if (head) await ctx.storage.delete(row.objectKey);
      await ctx.db.update(schema.mediaUpload).set({ status: 'rejected' }).where(eq(schema.mediaUpload.id, row.id));
      return c.json({ error: 'upload_incomplete' }, 400);
    }
    // Content is re-checked by signature in the worker before anything reads it.
    await ctx.db.update(schema.mediaUpload).set({ status: 'uploaded', bytes: head.size }).where(eq(schema.mediaUpload.id, row.id));
    return c.json({ id: row.id, kind: row.kind });
  });

  r.delete('/uploads/:id', requireVerified(), async (c) => {
    const [row] = await ctx.db
      .select()
      .from(schema.mediaUpload)
      .where(and(eq(schema.mediaUpload.id, c.req.param('id')), eq(schema.mediaUpload.userId, c.var.session!.user.id), ne(schema.mediaUpload.status, 'deleted')));
    if (!row) return c.json({ error: 'not_found' }, 404);
    await ctx.storage.delete(row.objectKey);
    await ctx.db.update(schema.mediaUpload).set({ status: 'deleted', analysis: null }).where(eq(schema.mediaUpload.id, row.id));
    return c.json({ ok: true });
  });

  return r;
}
