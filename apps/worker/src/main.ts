/** Standalone worker process (production: the Oracle VM). Requires DATABASE_URL. */
import { createDb, runMigrations } from '@thinkmade/db';
import { createEmbedServer } from './embed-server';
import { createWorkerDeps, startWorker } from './index';

if (!process.env.DATABASE_URL) {
  console.error('[worker] DATABASE_URL is required. Locally, the API runs the worker in-process instead.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
if (process.env.WORKER_MIGRATE === 'true') await runMigrations(handle);
const deps = await createWorkerDeps(handle.db);
const worker = startWorker(deps);
console.info('[worker] started');
// Optional: serve search-query embeddings to the API (see docs/worker.md).
const embedServer =
  process.env.EMBED_SERVER_PORT && deps.embedder
    ? createEmbedServer(deps.embedder, { token: process.env.EMBED_SERVER_TOKEN ?? '', log: (m) => console.warn(`[embed] ${m}`) }).listen(Number(process.env.EMBED_SERVER_PORT), () =>
        console.info(`[embed] serving ${deps.embedder!.name} on port ${process.env.EMBED_SERVER_PORT}`),
      )
    : null;
const shutdown = async () => {
  console.info('[worker] stopping after the current job…');
  embedServer?.close();
  await worker.stop();
  await handle.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
