import { Hono } from 'hono';
import { z } from 'zod';
import { sniffMediaType } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import type { AppContext } from '../create-context';
import { clientIp, rateLimit } from '../middleware/rate-limit';
import type { AppVariables } from '../middleware/session';

const MAX_SCREENSHOT = 5 * 1024 * 1024;

/** Only these diagnostics are kept. Anything else a client sends (tokens, cookies, content) is dropped. */
const diagnosticsSchema = z
  .object({
    appVersion: z.string().max(40),
    userAgent: z.string().max(300),
    platform: z.string().max(60),
    language: z.string().max(20),
    viewport: z.string().max(20),
    online: z.boolean(),
    standalone: z.boolean(),
    path: z.string().max(200).transform((p) => p.split(/[?#]/)[0]!),
    errorIds: z.array(z.string().max(100)).max(10),
    occurredAt: z.string().max(40),
  })
  .partial()
  .strip();

function sanitiseDiagnostics(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  // Validate field by field so one bad field does not discard the rest; unknown fields are dropped.
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const one = diagnosticsSchema.safeParse({ [k]: v });
    if (one.success && one.data[k as keyof typeof one.data] !== undefined) out[k] = one.data[k as keyof typeof one.data];
  }
  return out;
}

export function bugReportRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();
  r.post(
    '/bug-reports',
    rateLimit({ db: ctx.db, name: 'bugs', key: clientIp, limit: 10, windowSeconds: 3600, now: ctx.now }),
    async (c) => {
      let description = '';
      let diagnostics: unknown = {};
      let honeypot = '';
      let screenshot: Buffer | null = null;
      const type = c.req.header('content-type') ?? '';
      if (type.includes('multipart/form-data')) {
        const form = await c.req.formData().catch(() => null);
        description = String(form?.get('description') ?? '');
        honeypot = String(form?.get('website') ?? '');
        try {
          diagnostics = JSON.parse(String(form?.get('diagnostics') ?? '{}'));
        } catch {
          diagnostics = {};
        }
        const file = form?.get('screenshot');
        if (file instanceof File && file.size > 0) {
          if (file.size > MAX_SCREENSHOT) return c.json({ error: 'too_large', message: 'Screenshots can be up to 5 MB.' }, 413);
          const bytes = Buffer.from(await file.arrayBuffer());
          if (sniffMediaType(bytes)?.kind !== 'image') return c.json({ error: 'unsupported_media_type', message: 'The screenshot must be an image.' }, 415);
          screenshot = bytes;
        }
      } else {
        const body = (await c.req.json().catch(() => ({}))) as { description?: unknown; diagnostics?: unknown; website?: unknown };
        description = String(body.description ?? '');
        diagnostics = body.diagnostics ?? {};
        honeypot = String(body.website ?? '');
      }
      // Bots fill the hidden field; accept quietly and store nothing.
      if (honeypot) return c.json({ id: null, emailed: false }, 201);
      description = description.trim();
      if (description.length < 3 || description.length > 5000) return c.json({ error: 'invalid_request', message: 'Please describe the problem (up to 5,000 characters).' }, 400);

      const id = crypto.randomUUID();
      let screenshotKey: string | null = null;
      if (screenshot) {
        const mime = sniffMediaType(screenshot)!.mime;
        screenshotKey = `bug-screenshots/${id}.${mime.split('/')[1]}`;
        await ctx.storage.put(screenshotKey, screenshot, mime);
      }
      await ctx.db.insert(schema.bugReport).values({ id, userId: c.var.session?.user.id ?? null, description, screenshotKey, diagnostics: sanitiseDiagnostics(diagnostics), status: 'new' });

      const { settings } = await ctx.settings.getActive();
      let emailed = false;
      if (settings.bugReports.email) {
        const r = await ctx.sendEmail(
          {
            to: settings.bugReports.email,
            subject: `ThinkMade bug report: ${description.slice(0, 60)}`,
            text: `A new bug report was submitted.\n\n${description}\n\nOpen it in the admin dashboard: ${ctx.env.APP_URL}/admin/bugs\nReport ID: ${id}`,
          },
          'bug_report',
        );
        emailed = r.ok;
      }
      return c.json({ id, emailed }, 201);
    },
  );
  return r;
}
