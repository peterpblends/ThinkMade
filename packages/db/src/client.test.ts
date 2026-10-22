import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, queryRows, runMigrations, schema, type DbHandle } from './index';

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('createDb on pglite', () => {
  it('reports the pglite driver', () => {
    expect(handle.kind).toBe('pglite');
  });

  it('applies migrations and makes the vector extension usable', async () => {
    const rows = await queryRows<{ v: unknown }>(handle.db, sql`select '[1,2,3]'::vector(3) as v`);
    expect(String(rows[0]?.v)).toBe('[1,2,3]');
  });

  it('can insert and read a user', async () => {
    await handle.db.insert(schema.user).values({
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const users = await handle.db.select().from(schema.user);
    expect(users.map((u) => u.email)).toEqual(['ada@example.com']);
  });

  it('allows only one active app_setting version per name', async () => {
    await handle.db.insert(schema.appSetting).values({
      name: 'app',
      version: 1,
      document: { a: 1 },
      active: true,
    });
    await expect(
      handle.db.insert(schema.appSetting).values({
        name: 'app',
        version: 2,
        document: { a: 2 },
        active: true,
      }),
    ).rejects.toThrow();
    await handle.db.insert(schema.appSetting).values({
      name: 'app',
      version: 2,
      document: { a: 2 },
      active: false,
    });
  });

  it('has every core table from the design', async () => {
    const rows = await queryRows<{ table_name: string }>(
      handle.db,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const expected of [
      'user', 'session', 'account', 'verification', 'passkey', 'two_factor',
      'app_setting', 'audit_log', 'learning_request', 'mental_model', 'mental_model_relation',
      'author', 'book', 'book_author', 'source', 'podcast_series', 'episode',
      'episode_mental_model', 'episode_source', 'episode_quality_check', 'library_item',
      'playback_state', 'favorite', 'rating', 'download_manifest', 'sync_event',
      'coaching_session', 'coaching_message', 'generation_job', 'generation_stage',
      'media_upload', 'bug_report', 'email_delivery', 'usage_metric', 'rate_limit',
      'ai_model_config', 'prompt_version',
    ]) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
  });
});
