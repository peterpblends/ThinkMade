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

export const MODEL_STAGES = ['understand', 'select_models', 'research', 'plan', 'script', 'validate', 'coach', 'vision', 'embed'] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface StageModel {
  provider: string;
  model: string;
  params: Record<string, unknown>;
}

type StageDefault = Omit<StageModel, 'params'> & { params?: Record<string, unknown> };

// Groq's free tier refuses any request over 8,000 tokens (its per-minute limit), counting prompt and
// max_tokens; tm_request_token_limit keeps requests under it with a margin.
const GROQ_FREE = { reasoning_effort: 'low', tm_request_token_limit: 7500 };
const QWEN = { provider: 'groq', model: 'qwen/qwen3.8-27b', params: GROQ_FREE };
const GPT_OSS_120B = { provider: 'groq', model: 'openai/gpt-oss-120b', params: GROQ_FREE };
const GPT_OSS_20B = { provider: 'groq', model: 'openai/gpt-oss-20b', params: GROQ_FREE };

/**
 * Zero-cost defaults (checked October 2026). Each Groq model has its own daily allowance on the free
 * tier, so stages are spread across three models. Groq's free tier has no vision model, so photos and
 * video frames go to Gemma 4 on OpenRouter's free tier.
 */
export const FREE_STAGE_MODELS: Record<ModelStage, StageDefault> = {
  understand: QWEN,
  select_models: QWEN,
  research: GPT_OSS_120B,
  plan: QWEN,
  script: GPT_OSS_120B,
  validate: QWEN,
  coach: GPT_OSS_20B,
  vision: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  // EmbeddingGemma 2 runs on the worker; the API reaches it through EMBED_SERVER_URL.
  embed: { provider: 'local', model: 'embeddinggemma-2' },
};

/** Groq models that have left the free tier. Rows still pointing at them are moved to the current default. */
const RETIRED_GROQ_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
]);

/** The model a stage uses when nothing is stored: an override (local or test provider) or the free defaults. */
export function defaultStageModel(stage: ModelStage, override?: { provider: string; model: string } | null): StageModel {
  if (override && stage !== 'embed') return { provider: override.provider, model: override.model, params: {} };
  // Tests use the dependency-free keyword embedder rather than downloading a model.
  if (override?.provider === 'fake' && stage === 'embed') return { provider: 'hash', model: 'hash', params: {} };
  const d = FREE_STAGE_MODELS[stage];
  return { provider: d.provider, model: d.model, params: d.params ?? {} };
}

/**
 * Inserts a default model row for any stage without one. Existing admin choices are kept, except
 * rows on Groq models that were retired from the free tier, which would otherwise fail every job.
 */
export async function seedModelConfig(db: Db, override?: { provider: string; model: string } | null) {
  const rows = await db.select({ stage: aiModelConfig.stage, provider: aiModelConfig.provider, model: aiModelConfig.model }).from(aiModelConfig);
  const existing = new Map(rows.map((r) => [r.stage, r]));
  for (const stage of MODEL_STAGES) {
    const row = existing.get(stage);
    const values = defaultStageModel(stage, override);
    if (!row) {
      await db.insert(aiModelConfig).values({ stage, ...values }).onConflictDoNothing();
    } else if ((row.provider === 'groq' && RETIRED_GROQ_MODELS.has(row.model)) || (row.provider === 'hash' && row.model === 'hash-384' && values.provider !== 'hash')) {
      // Retired Groq models, and the old keyword-embedder default, move to the current defaults.
      await db.update(aiModelConfig).set({ ...values, updatedAt: new Date() }).where(eq(aiModelConfig.stage, stage));
    }
  }
}

export async function getStageModel(db: Db, stage: ModelStage): Promise<StageModel | null> {
  const [row] = await db.select().from(aiModelConfig).where(eq(aiModelConfig.stage, stage));
  return row ? { provider: row.provider, model: row.model, params: row.params ?? {} } : null;
}
