import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import type { DbHandle } from './client';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Enables pgvector, then applies every pending migration from packages/db/migrations. */
export async function runMigrations(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`create extension if not exists vector`);
  if (handle.kind === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder });
  }
}
