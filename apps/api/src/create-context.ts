import { createDb, getStageModel, runMigrations, type Db, type ModelStage } from '@thinkmade/db';
import { consoleEmailSender, createLlm, createStorage, createLocalStorage, createStt, memoryEmailSender, type EmailSender, type LlmClient, type ObjectStorage, type SttEngine } from '@thinkmade/ai';
import { createAuth, type Auth } from './auth';
import { loadEnv, type Env } from './env';
import { createSettingsService, type SettingsService } from './settings/settings-service';

import type { WorkerDeps } from '@thinkmade/worker';

/** Worker dependencies, present only when this process can run jobs itself (local development and tests). */
export type InProcessWorker = WorkerDeps;

export interface AppContext {
  db: Db;
  dbKind: 'pg' | 'pglite';
  auth: Auth;
  env: Env;
  email: EmailSender;
  settings: SettingsService;
  storage: ObjectStorage;
  stt: SttEngine | null;
  /** Language model for a stage, as configured by administrators. */
  llm: (stage: ModelStage) => Promise<LlmClient>;
  worker: InProcessWorker | null;
  /** Wakes the in-process worker loop after a job is created. */
  pokeWorker: () => void;
  now: () => Date;
}

export interface CreateContextOptions {
  env?: Env;
  email?: EmailSender;
  pgliteDir?: string;
  storageDir?: string;
  /**
   * Apply pending migrations at startup. Defaults to true. Serverless production sets this to false
   * and runs `npm run db:migrate` as a deploy step instead.
   */
  migrate?: boolean;
  /** Run the job loop inside this process. Defaults to true for local runs without DATABASE_URL (except tests). */
  embeddedWorker?: boolean;
  /** Build worker dependencies in this process at all. Serverless functions never run jobs. */
  inProcessWorker?: boolean;
}

/** Builds the database, runs migrations and wires auth. One context per process or serverless instance. */
export async function createContext(
  options: CreateContextOptions = {},
): Promise<AppContext & { close(): Promise<void> }> {
  const env = options.env ?? loadEnv();
  const handle = await createDb({
    databaseUrl: env.DATABASE_URL,
    pgliteDir: options.pgliteDir ?? env.PGLITE_DIR,
  });
  if (options.migrate ?? true) await runMigrations(handle);
  const email = options.email ?? (env.NODE_ENV === 'test' ? memoryEmailSender() : consoleEmailSender());
  const rawEnv = { ...process.env, NODE_ENV: env.NODE_ENV };
  const storage = options.storageDir ? createLocalStorage(options.storageDir) : createStorage(rawEnv);
  const auth = createAuth({ db: handle.db, env, email, storage });
  const settings = createSettingsService(handle.db);
  await settings.seedDefaults();
  const stt = createStt(rawEnv);

  // Without DATABASE_URL the database is embedded and single-process, so jobs must run here.
  let worker: InProcessWorker | null = null;
  let loop: { poke: () => void; stop: () => Promise<void> } | null = null;
  if (options.inProcessWorker ?? !env.DATABASE_URL) {
    const { createWorkerDeps, startWorker } = await import('@thinkmade/worker');
    worker = await createWorkerDeps(handle.db, rawEnv, { storage });
    const embedded = options.embeddedWorker ?? (env.NODE_ENV !== 'test' || process.env.EMBEDDED_WORKER === 'true');
    if (embedded) loop = startWorker(worker);
  }

  return {
    db: handle.db,
    dbKind: handle.kind,
    auth,
    env,
    email,
    settings,
    storage,
    stt,
    llm: async (stage) => {
      const cfg = (await getStageModel(handle.db, stage)) ?? { provider: process.env.DEFAULT_LLM_PROVIDER ?? 'groq', model: process.env.DEFAULT_LLM_MODEL ?? 'llama-3.3-70b-versatile' };
      return createLlm(cfg, rawEnv);
    },
    worker,
    pokeWorker: () => loop?.poke(),
    now: () => new Date(),
    close: async () => {
      await loop?.stop();
      await handle.close();
    },
  };
}
