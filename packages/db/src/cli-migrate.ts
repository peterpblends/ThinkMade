/**
 * Deploy-time migration: `npm run db:migrate` with DATABASE_URL set.
 * Production functions never migrate on cold start; this runs once per deploy.
 */
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { runMigrations } from './migrate';

export async function migrateFromEnv(env: Record<string, string | undefined>): Promise<void> {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');
  const handle = await createDb({ databaseUrl: env.DATABASE_URL });
  try {
    await runMigrations(handle);
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateFromEnv(process.env)
    .then(() => console.info('[db] migrations applied'))
    .catch((err) => {
      console.error('[db] migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
