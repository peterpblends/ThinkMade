import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import type { DbHandle } from './client';

// Bundlers (scripts/build-vercel.ts) define this so the folder resolves next to the bundle instead.
declare const __THINKMADE_MIGRATIONS_REL__: string | undefined;
const migrationsRel = typeof __THINKMADE_MIGRATIONS_REL__ === 'string' ? __THINKMADE_MIGRATIONS_REL__ : '../migrations';
const migrationsFolder = fileURLToPath(new URL(migrationsRel, import.meta.url));

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
