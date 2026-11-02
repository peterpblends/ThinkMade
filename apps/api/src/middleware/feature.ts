import { createMiddleware } from 'hono/factory';
import { FEATURE_INFO, type FeatureKey } from '@thinkmade/shared';
import type { AppContext } from '../create-context';

/** Refuses the request when an administrator has switched the feature off. */
export function requireFeature(ctx: AppContext, ...keys: FeatureKey[]) {
  return createMiddleware(async (c, next) => {
    const { features } = (await ctx.settings.getActive()).settings;
    const off = keys.find((k) => !features[k]);
    if (off) return c.json({ error: 'feature_off', feature: off, message: `${FEATURE_INFO[off].label} is turned off right now.` }, 403);
    await next();
  });
}
