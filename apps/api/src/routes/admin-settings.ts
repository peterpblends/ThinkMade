import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { appSettingsPatchSchema } from '@thinkmade/shared';
import type { AppContext } from '../create-context';
import { clientIp } from '../middleware/rate-limit';
import type { AppVariables } from '../middleware/session';

const putBody = z.strictObject({ patch: appSettingsPatchSchema, note: z.string().max(500).optional() });
const rollbackBody = z.strictObject({ version: z.number().int().positive() });

/** Mounted under /api/admin, which already enforces requireAdmin. */
export function adminSettingsRoutes(ctx: AppContext) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.get('/settings', async (c) => c.json(await ctx.settings.getActive()));

  r.get('/settings/versions', async (c) => c.json({ versions: await ctx.settings.listVersions() }));

  r.put('/settings', async (c) => {
    const parsed = putBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      const actor = { id: c.var.session!.user.id, ip: clientIp(c) };
      return c.json(await ctx.settings.update(parsed.data.patch, actor, parsed.data.note));
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: 'invalid_settings', issues: err.issues }, 400);
      throw err;
    }
  });

  r.post('/settings/rollback', async (c) => {
    const parsed = rollbackBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    try {
      const actor = { id: c.var.session!.user.id, ip: clientIp(c) };
      return c.json(await ctx.settings.rollback(parsed.data.version, actor));
    } catch (err) {
      if (err instanceof Error && /does not exist/.test(err.message)) {
        return c.json({ error: 'version_not_found' }, 404);
      }
      throw err;
    }
  });

  return r;
}
