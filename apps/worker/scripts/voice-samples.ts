/**
 * Renders the short spoken sample for every voice listeners may pick that doesn't have one yet, and
 * uploads them to storage (see the Voice samples workflow). Requires DATABASE_URL and the storage settings.
 *   npm run voice-samples -w apps/worker
 */
import { createDb } from '@thinkmade/db';
import { createWorkerDeps, ensureVoiceSamples } from '../src/index';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
const handle = await createDb({ databaseUrl: process.env.DATABASE_URL });
const deps = await createWorkerDeps(handle.db, process.env, { log: (m, x) => console.warn(m, JSON.stringify(x ?? {})) });
const made = await ensureVoiceSamples(deps, 60 * 60_000);
console.info(`${made} voice sample(s) rendered`);
await handle.close();
process.exit(0);
