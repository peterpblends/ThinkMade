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
// When a model's free allowance runs out, the next free source is tried: Groq's other model (its own
// daily allowance), then Google's Gemini Flash models (free tier without a card, about 1,500 requests a day
// each; the "-latest" aliases follow Google's newest Flash models), then OpenRouter's free models (about 50
// requests a day in total, shared with photo analysis). Fallbacks without an API key are skipped. Free models
// come and go; the OpenRouter ones answered ThinkMade's JSON prompts in live tests on 2026-10-25.
const GEMINI_FREE = [
  { provider: 'gemini', model: 'gemini-flash-latest' },
  { provider: 'gemini', model: 'gemini-flash-lite-latest' },
];
const OPENROUTER_FREE = [
  { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' },
  // Listed on 2026-10-26 (Models workflow); a last resort if the two above are busy upstream.
  { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { provider: 'openrouter', model: 'thinkingmachines/inkling:free' },
];
const GPT_OSS_120B = {
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  params: { ...GROQ_FREE, tm_fallbacks: [{ provider: 'groq', model: 'openai/gpt-oss-20b', params: GROQ_FREE }, ...GEMINI_FREE, ...OPENROUTER_FREE] },
};
const GPT_OSS_20B = {
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  params: { ...GROQ_FREE, tm_fallbacks: [{ provider: 'groq', model: 'openai/gpt-oss-120b', params: GROQ_FREE }, ...GEMINI_FREE, ...OPENROUTER_FREE] },
};

/**
 * Zero-cost defaults (checked October 2026). Each Groq model has its own daily allowance on the free
 * tier, so stages are spread across two models. Qwen3.8-27B isn't used: some free accounts cap it at
 * 1,000 output tokens a minute, which a plan or script can't fit in. Groq's free tier has no vision
 * model, so photos and video frames go to Gemma 4 on OpenRouter's free tier.
 */
export const FREE_STAGE_MODELS: Record<ModelStage, StageDefault> = {
  understand: GPT_OSS_20B,
  select_models: GPT_OSS_20B,
  research: GPT_OSS_120B,
  plan: GPT_OSS_120B,
  script: GPT_OSS_120B,
  validate: GPT_OSS_20B,
  coach: GPT_OSS_20B,
  vision: {
    provider: 'openrouter',
    model: 'google/gemma-4-31b-it:free',
    // Gemma is often rate limited upstream; Gemini Flash (which reads images) and NVIDIA's free vision model are the backups.
    params: {
      tm_fallbacks: [...GEMINI_FREE, { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' }, { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' }],
    },
  },
  // EmbeddingGemma 2 runs on the worker; the API reaches it through EMBED_SERVER_URL.
  embed: { provider: 'local', model: 'embeddinggemma-2' },
};

/**
 * The model an administrator chose for a stage, followed by the stage's recommended model and its free
 * backups: a choice of one model never removes the switch-over when that model is busy, out of allowance or
 * misconfigured. Duplicates are dropped. Settings that already list their own backups are kept as they are.
 */
export function withRecommendedFallbacks(stage: ModelStage, cfg: StageModel): StageModel {
  if (stage === 'embed' || Array.isArray(cfg.params?.tm_fallbacks)) return cfg;
  const rec = defaultStageModel(stage, null);
  const chain = [{ provider: rec.provider, model: rec.model, params: withoutFallbacks(rec.params) }, ...((rec.params.tm_fallbacks as Array<{ provider: string; model: string; params?: Record<string, unknown> }>) ?? [])];
  const seen = new Set([`${cfg.provider}|${cfg.model}`]);
  const fallbacks = chain.filter((f) => !seen.has(`${f.provider}|${f.model}`) && seen.add(`${f.provider}|${f.model}`));
  return { ...cfg, params: { ...cfg.params, tm_fallbacks: fallbacks } };
}

function withoutFallbacks(params: Record<string, unknown>): Record<string, unknown> {
  const { tm_fallbacks: _, ...rest } = params;
  return rest;
}

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
 * Inserts a default model row for any stage without one. Rows an administrator chose (updated_by set)
 * are kept, unless they point at a Groq model retired from the free tier, which would fail every job.
 * Rows nobody chose follow the current defaults, so improved defaults reach existing databases.
 */
export async function seedModelConfig(db: Db, override?: { provider: string; model: string } | null) {
  const rows = await db
    .select({ stage: aiModelConfig.stage, provider: aiModelConfig.provider, model: aiModelConfig.model, params: aiModelConfig.params, updatedBy: aiModelConfig.updatedBy })
    .from(aiModelConfig);
  const existing = new Map(rows.map((r) => [r.stage, r]));
  for (const stage of MODEL_STAGES) {
    const row = existing.get(stage);
    const values = defaultStageModel(stage, override);
    if (!row) {
      await db.insert(aiModelConfig).values({ stage, ...values }).onConflictDoNothing();
      continue;
    }
    const retired = (row.provider === 'groq' && RETIRED_GROQ_MODELS.has(row.model)) || (row.provider === 'hash' && row.model === 'hash-384' && values.provider !== 'hash');
    const stale = !row.updatedBy && (row.provider !== values.provider || row.model !== values.model || JSON.stringify(row.params ?? {}) !== JSON.stringify(values.params));
    if (retired || stale) {
      await db.update(aiModelConfig).set({ ...values, updatedAt: new Date() }).where(eq(aiModelConfig.stage, stage));
    }
  }
}

/** A stage's model as stored, with the recommended backups added after an administrator's own choice. */
export async function getStageModel(db: Db, stage: ModelStage): Promise<StageModel | null> {
  const [row] = await db.select().from(aiModelConfig).where(eq(aiModelConfig.stage, stage));
  return row ? withRecommendedFallbacks(stage, { provider: row.provider, model: row.model, params: row.params ?? {} }) : null;
}
