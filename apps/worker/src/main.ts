/**
 * Standalone worker process (an always-on server, your Mac, or GitHub Actions). Requires DATABASE_URL.
 * WORKER_DRAIN=true runs queued jobs until the queue is empty, then exits (for on-demand runners).
 */
import { createDb, runMigrations } from '@thinkmade/db';
import { createEmbedServer } from './embed-server';
import { secondsUntilNextJob } from './queue';
import { cleanupExpiredUploads, createWorkerDeps, reindexPublicSeries, runNextJob, startWorker } from './index';

if (!process.env.DATABASE_URL) {
  console.error('[worker] DATABASE_URL is required. Locally, the API runs the worker in-process instead.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
if (process.env.WORKER_MIGRATE === 'true') await runMigrations(handle);
const deps = await createWorkerDeps(handle.db);
if (process.env.WORKER_DRAIN === 'true') {
  let jobs = 0;
  const deadline = Date.now() + Number(process.env.WORKER_DRAIN_MINUTES ?? 300) * 60_000;
  // Jobs waiting a short retry delay are waited for; anything further off is left for the next run.
  while (Date.now() < deadline) {
    if (await runNextJob(deps)) {
      jobs++;
      continue;
    }
    const wait = await secondsUntilNextJob(handle.db, 600);
    if (wait === null) break;
    await new Promise((r) => setTimeout(r, Math.max(5, wait) * 1000));
  }
  await cleanupExpiredUploads(deps).catch((err) => console.warn('[worker] cleanup failed', String(err)));
  const indexed = await reindexPublicSeries(deps).catch((err) => (console.warn('[worker] indexing failed', String(err)), 0));
  console.info(`[worker] queue drained: ${jobs} job(s) run, ${indexed} series indexed`);
  await handle.close();
  process.exit(0);
}
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
