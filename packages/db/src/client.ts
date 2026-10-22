import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema/index';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'pg' | 'pglite';
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Postgres connection string. When set, the node-postgres driver is used. */
  databaseUrl?: string | undefined;
  /** Directory for the embedded PGlite database, or ':memory:' for an ephemeral one. */
  pgliteDir?: string | undefined;
}

export async function createDb(options: CreateDbOptions): Promise<DbHandle> {
  if (options.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: options.databaseUrl });
    const db = drizzle(pool, { schema });
    return { db, kind: 'pg', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dir = options.pgliteDir ?? '.data/pglite';
  const client =
    dir === ':memory:' ? new PGlite({ extensions: { vector } }) : new PGlite(dir, { extensions: { vector } });
  await client.waitReady;
  const db = drizzle(client, { schema });
  return { db, kind: 'pglite', close: () => client.close() };
}

/** Runs a raw SQL query and returns its rows. Both node-postgres and PGlite results carry `rows`. */
export async function queryRows<T extends Record<string, unknown> = Record<string, unknown>>(
  db: Db,
  query: SQL,
): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
