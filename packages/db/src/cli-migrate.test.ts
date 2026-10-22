import { describe, expect, it } from 'vitest';
import { migrateFromEnv } from './cli-migrate';

describe('migrateFromEnv', () => {
  it('refuses to run without DATABASE_URL so it never migrates the wrong database by accident', async () => {
    await expect(migrateFromEnv({})).rejects.toThrow(/DATABASE_URL/);
  });
});
