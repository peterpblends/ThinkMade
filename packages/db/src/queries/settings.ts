import { and, eq } from 'drizzle-orm';
import { appSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '@thinkmade/shared';
import type { Db } from '../client';
import { aiModelConfig, appSetting } from '../schema/index';

/** Active admin settings, or the spec defaults when none are stored yet. */
export async function getActiveAppSettings(db: Db): Promise<AppSettings> {
  const [row] = await db
    .select({ document: appSetting.document })
    .from(appSetting)
    .where(and(eq(appSetting.name, 'app'), eq(appSetting.active, true)));
  return row ? appSettingsSchema.parse(row.document) : DEFAULT_APP_SETTINGS;
}

export const MODEL_STAGES = ['understand', 'select_models', 'research', 'plan', 'script', 'validate', 'coach', 'vision'] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface StageModel {
  provider: string;
  model: string;
  params: Record<string, unknown>;
}

/** Inserts a default model row for any stage without one. Existing admin choices are kept. */
export async function seedModelConfig(db: Db, defaults: { provider: string; model: string; visionModel?: string }) {
  const existing = new Set((await db.select({ stage: aiModelConfig.stage }).from(aiModelConfig)).map((r) => r.stage));
  for (const stage of MODEL_STAGES) {
    if (existing.has(stage)) continue;
    await db
      .insert(aiModelConfig)
      .values({ stage, provider: defaults.provider, model: stage === 'vision' && defaults.visionModel ? defaults.visionModel : defaults.model, params: {} })
      .onConflictDoNothing();
  }
}

export async function getStageModel(db: Db, stage: ModelStage): Promise<StageModel | null> {
  const [row] = await db.select().from(aiModelConfig).where(eq(aiModelConfig.stage, stage));
  return row ? { provider: row.provider, model: row.model, params: row.params ?? {} } : null;
}
