import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations, schema, type DbHandle } from '../index';
import { defaultStageModel, FREE_STAGE_MODELS, getStageModel, MODEL_STAGES, seedModelConfig } from './settings';

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('free model defaults', () => {
  it('never points at a model Groq has retired', () => {
    for (const stage of MODEL_STAGES) expect(FREE_STAGE_MODELS[stage].model).not.toMatch(/llama/i);
  });

  it('uses an override for every stage except embedding', () => {
    expect(defaultStageModel('script', { provider: 'ollama', model: 'qwen2.5:7b' })).toEqual({ provider: 'ollama', model: 'qwen2.5:7b', params: {} });
    expect(defaultStageModel('embed', { provider: 'ollama', model: 'qwen2.5:7b' }).provider).toBe('local');
    expect(defaultStageModel('embed', { provider: 'fake', model: 'fake' }).provider).toBe('hash');
    expect(defaultStageModel('vision').provider).toBe('openrouter');
  });

  it('seeds every stage, keeps admin choices and replaces retired Groq models', async () => {
    const t = schema.aiModelConfig;
    await handle.db.insert(t).values({ stage: 'script', provider: 'groq', model: 'llama-3.3-70b-versatile', params: {} });
    await handle.db.insert(schema.user).values({ id: 'admin1', name: 'A', email: 'a@example.com', emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await handle.db.insert(t).values({ stage: 'coach', provider: 'ollama', model: 'mine', params: {}, updatedBy: 'admin1' });
    await handle.db.insert(t).values({ stage: 'validate', provider: 'groq', model: 'qwen/qwen3.8-27b', params: {} });
    await seedModelConfig(handle.db);
    expect(await getStageModel(handle.db, 'script')).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b', params: { reasoning_effort: 'low', tm_request_token_limit: 7500 } });
    expect((await getStageModel(handle.db, 'coach'))?.model).toBe('mine'); // an admin's choice is kept
    expect((await getStageModel(handle.db, 'validate'))?.model).toBe('openai/gpt-oss-20b'); // an old default follows the new one
    expect((await getStageModel(handle.db, 'plan'))?.model).toBe('openai/gpt-oss-120b');
    expect((await handle.db.select().from(t).where(eq(t.stage, 'vision')))[0]?.model).toBe('google/gemma-4-31b-it:free');
  });
});
