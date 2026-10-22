import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations, schema, type DbHandle } from '@thinkmade/db';
import { DEFAULT_APP_SETTINGS } from '@thinkmade/shared';
import { createSettingsService, type SettingsService } from './settings-service';

let handle: DbHandle;
let svc: SettingsService;
const actor = { id: 'admin-1', ip: '1.2.3.4' };

beforeEach(async () => {
  handle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
  await handle.db.insert(schema.user).values({ id: 'admin-1', name: 'Admin', email: 'admin@example.com' });
  svc = createSettingsService(handle.db);
  await svc.seedDefaults();
});
afterEach(() => handle.close());

describe('settings service', () => {
  it('seedDefaults creates version 1 equal to the spec defaults', async () => {
    const active = await svc.getActive();
    expect(active).toEqual({ version: 1, settings: DEFAULT_APP_SETTINGS });
  });

  it('seedDefaults is idempotent', async () => {
    await svc.seedDefaults();
    expect(await svc.listVersions()).toHaveLength(1);
  });

  it('update merges, creates version 2 and writes an audit row', async () => {
    const next = await svc.update({ podcast: { defaultEpisodes: 5 } }, actor, 'more episodes');
    expect(next.version).toBe(2);
    expect(next.settings.podcast.defaultEpisodes).toBe(5);
    expect(next.settings.podcast.defaultLengthMinutes).toBe(15);
    expect((await svc.getActive()).version).toBe(2);
    const audits = await handle.db.select().from(schema.auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'settings.update', actorId: 'admin-1', ip: '1.2.3.4' });
  });

  it('rollback to 1 creates version 3 holding the version 1 document', async () => {
    await svc.update({ podcast: { defaultEpisodes: 5 } }, actor);
    const rolled = await svc.rollback(1, actor);
    expect(rolled.version).toBe(3);
    expect(rolled.settings).toEqual(DEFAULT_APP_SETTINGS);
    const audits = await handle.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'settings.rollback'));
    expect(audits).toHaveLength(1);
  });

  it('rollback to a missing version throws', async () => {
    await expect(svc.rollback(99, actor)).rejects.toThrow(/version 99/);
  });

  it('update rejects an invalid patch and leaves the active version unchanged', async () => {
    await expect(svc.update({ podcast: { defaultEpisodes: 0 } }, actor)).rejects.toThrow();
    expect((await svc.getActive()).version).toBe(1);
  });

  it('concurrent updates keep versions distinct with exactly one active', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => svc.update({ podcast: { defaultEpisodes: n } }, actor)));
    const versions = await svc.listVersions();
    expect(versions.map((v) => v.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(versions.filter((v) => v.active)).toHaveLength(1);
  });
});
