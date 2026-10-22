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
    // Production uses Postgres with migrations applied at deploy time; local runs use PGlite and migrate here.
    const ctx = await createContext({ env, migrate: !env.DATABASE_URL, inProcessWorker: false });
    return createApp(ctx);
  })().catch((err) => {
    appPromise = null; // allow the next request to retry after a failed cold start
    throw err;
  });
  return appPromise;
}

export default getRequestListener(async (request) => {
  const app = await getApp();
  return app.fetch(request);
});
