import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@thinkmade/db';
import {
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  applySettingsPatch,
  type AppSettings,
  type AppSettingsPatch,
} from '@thinkmade/shared';

const NAME = 'app';

export interface Actor {
  id: string;
  ip?: string | undefined;
}

export interface VersionedSettings {
  version: number;
  settings: AppSettings;
}

export interface SettingsVersionInfo {
  version: number;
  createdAt: Date;
  createdBy: string | null;
  note: string | null;
  active: boolean;
}

export interface SettingsService {
  getActive(): Promise<VersionedSettings>;
  update(patch: AppSettingsPatch, actor: Actor, note?: string): Promise<VersionedSettings>;
  listVersions(): Promise<SettingsVersionInfo[]>;
  rollback(version: number, actor: Actor): Promise<VersionedSettings>;
  seedDefaults(): Promise<void>;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createSettingsService(db: Db): SettingsService {
  /** Serialises writers on this settings name for the rest of the transaction. */
  async function lock(tx: Tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'app_setting:' + NAME}))`);
  }

  async function activeIn(tx: Tx | Db): Promise<VersionedSettings | null> {
    const [row] = await tx
      .select({ version: schema.appSetting.version, document: schema.appSetting.document })
      .from(schema.appSetting)
      .where(and(eq(schema.appSetting.name, NAME), eq(schema.appSetting.active, true)));
    if (!row) return null;
    return { version: row.version, settings: appSettingsSchema.parse(row.document) };
  }

  /** Inserts `settings` as the next version, makes it the only active one, and audits the change. */
  async function writeVersion(
    tx: Tx,
    settings: AppSettings,
    previous: VersionedSettings | null,
    actor: Actor | null,
    action: string,
    note: string | null,
  ): Promise<VersionedSettings> {
    const [max] = await tx
      .select({ v: sql<number>`coalesce(max(${schema.appSetting.version}), 0)` })
      .from(schema.appSetting)
      .where(eq(schema.appSetting.name, NAME));
    const version = Number(max?.v ?? 0) + 1;
    await tx
      .update(schema.appSetting)
      .set({ active: false })
      .where(and(eq(schema.appSetting.name, NAME), eq(schema.appSetting.active, true)));
    await tx.insert(schema.appSetting).values({
      name: NAME,
      version,
      document: settings as unknown as Record<string, unknown>,
      active: true,
      note,
      createdBy: actor?.id ?? null,
    });
    if (actor) {
      await tx.insert(schema.auditLog).values({
        actorId: actor.id,
        action,
        targetType: 'app_setting',
        targetId: `${NAME}@${version}`,
        before: previous?.settings ?? null,
        after: settings,
        ip: actor.ip ?? null,
      });
    }
    return { version, settings };
  }

  return {
    async getActive() {
      const active = await activeIn(db);
      if (!active) throw new Error('No active settings. Call seedDefaults() at startup.');
      return active;
    },

    async update(patch, actor, note) {
      return db.transaction(async (tx) => {
        await lock(tx);
        const current = await activeIn(tx);
        if (!current) throw new Error('No active settings to update.');
        const next = applySettingsPatch(current.settings, patch);
        return writeVersion(tx, next, current, actor, 'settings.update', note ?? null);
      });
    },

    async listVersions() {
      const rows = await db
        .select({
          version: schema.appSetting.version,
          createdAt: schema.appSetting.createdAt,
          createdBy: schema.appSetting.createdBy,
          note: schema.appSetting.note,
          active: schema.appSetting.active,
        })
        .from(schema.appSetting)
        .where(eq(schema.appSetting.name, NAME))
        .orderBy(desc(schema.appSetting.version));
      return rows;
    },

    async rollback(version, actor) {
      return db.transaction(async (tx) => {
        await lock(tx);
        const [target] = await tx
          .select({ document: schema.appSetting.document })
          .from(schema.appSetting)
          .where(and(eq(schema.appSetting.name, NAME), eq(schema.appSetting.version, version)));
        if (!target) throw new Error(`Settings version ${version} does not exist.`);
        const current = await activeIn(tx);
        const settings = appSettingsSchema.parse(target.document);
        return writeVersion(tx, settings, current, actor, 'settings.rollback', `Rollback to version ${version}`);
      });
    },

    async seedDefaults() {
      await db.transaction(async (tx) => {
        await lock(tx);
        if (await activeIn(tx)) return;
        await writeVersion(tx, DEFAULT_APP_SETTINGS, null, null, 'settings.seed', 'Spec defaults');
      });
    },
  };
}
