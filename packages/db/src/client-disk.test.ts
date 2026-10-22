import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, schema } from './index';

const base = mkdtempSync(join(tmpdir(), 'tm-db-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('createDb on disk', () => {
  it('creates missing parent folders on a fresh clone and keeps data across restarts', async () => {
    const dir = join(base, 'nested', '.data', 'pglite');
    const first = await createDb({ pgliteDir: dir });
    await runMigrations(first);
    await first.db.insert(schema.user).values({ id: 'u1', name: 'A', email: 'a@example.com' });
    await first.close();

    const second = await createDb({ pgliteDir: dir });
    const users = await second.db.select().from(schema.user);
    await second.close();
    expect(users.map((u) => u.email)).toEqual(['a@example.com']);
  });
});
