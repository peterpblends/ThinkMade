/**
 * Vercel serverless entry. Bundled by scripts/build-vercel.ts into .vercel/output/functions/api.func.
 * One context per function instance, created on the first request and reused while the instance is warm.
 */
import { getRequestListener } from '@hono/node-server';
import { createApp } from './app';
import { createContext } from './create-context';
import { loadEnv } from './env';

let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

function getApp() {
  appPromise ??= (async () => {
    const env = loadEnv();
    // Production uses Postgres, migrated by the production build (scripts/build-vercel.ts); local runs use PGlite and migrate here.
    const ctx = await createContext({ env, migrate: !env.DATABASE_URL, inProcessWorker: false });
    return createApp(ctx);
  })().catch((err) => {
    // Without this, a failed cold start is an empty 500 with nothing in the logs.
    console.error('[api] startup failed:', err instanceof Error ? err.message : err);
    appPromise = null; // allow the next request to retry after a failed cold start
    throw err;
  });
  return appPromise;
}

export default getRequestListener(async (request) => {
  const app = await getApp();
  return app.fetch(request);
});
