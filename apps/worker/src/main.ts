/** Standalone worker process (production: the Oracle VM). Requires DATABASE_URL. */
import { createDb, runMigrations } from '@thinkmade/db';
import { createWorkerDeps, startWorker } from './index';

if (!process.env.DATABASE_URL) {
  console.error('[worker] DATABASE_URL is required. Locally, the API runs the worker in-process instead.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
if (process.env.WORKER_MIGRATE === 'true') await runMigrations(handle);
const worker = startWorker(await createWorkerDeps(handle.db));
console.info('[worker] started');
const shutdown = async () => {
  console.info('[worker] stopping after the current job…');
  await worker.stop();
  await handle.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
