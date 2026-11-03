import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalStorage, createToneTts, setFakeResponder, createLlm, type ChatMessage } from '@thinkmade/ai';
import { createDb, runMigrations, schema, seedModelConfig, type DbHandle } from '@thinkmade/db';
import { DEFAULT_APP_SETTINGS, type GenerationOptions } from '@thinkmade/shared';
import type { WorkerDeps } from '../deps';
import { fakeResponder, fakeVerifyBook } from './fake-responder';

export const OPTIONS: GenerationOptions = {
  lengthMinutes: 1,
  episodes: 2,
  speakerFormat: 'mixed',
  learningMode: 'explore',
  visibility: 'private',
  language: 'en',
  teachingStyle: 'conversational_practical',
  voices: { single: 'af_heart', hostA: 'af_heart', hostB: 'am_michael' },
  bitrateKbps: 48,
  maxTokens: 400_000,
  maxAudioMinutes: 240,
};

export async function makeWorld(responder: (m: ChatMessage[]) => string = fakeResponder) {
  const handle: DbHandle = await createDb({ pgliteDir: ':memory:' });
  await runMigrations(handle);
  await handle.db.insert(schema.user).values({ id: 'u1', name: 'Ada', email: 'ada@example.com', emailVerified: true });
  await seedModelConfig(handle.db, { provider: 'fake', model: 'fake' });
  setFakeResponder(responder);
  const dir = mkdtempSync(join(tmpdir(), 'tm-worker-'));
  const storage = createLocalStorage(join(dir, 'store'));
  const deps: WorkerDeps = {
    db: handle.db,
    llm: async () => createLlm({ provider: 'fake', model: 'fake' }, { NODE_ENV: 'test' }),
    tts: createToneTts(),
    storage,
    verifyBook: fakeVerifyBook,
    workDir: join(dir, 'work'),
    workerId: 'test-worker',
    stepRetryDelayMs: 0,
  };
  const settings = { ...DEFAULT_APP_SETTINGS, limits: { ...DEFAULT_APP_SETTINGS.limits, generationConcurrency: 2 } };
  await handle.db.insert(schema.appSetting).values({ name: 'app', version: 1, document: settings as never, active: true });

  async function enqueue(topic: string, options: Partial<GenerationOptions> = {}) {
    const [req] = await handle.db
      .insert(schema.learningRequest)
      .values({ userId: 'u1', inputText: topic, learningMode: options.learningMode ?? OPTIONS.learningMode })
      .returning();
    const [job] = await handle.db
      .insert(schema.generationJob)
      .values({ userId: 'u1', learningRequestId: req!.id, options: { ...OPTIONS, ...options } as never })
      .returning();
    return job!;
  }
  return { handle, db: handle.db, deps, storage, enqueue };
}
