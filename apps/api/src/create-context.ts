import { createDb, defaultStageModel, getStageModel, runMigrations, schema, type Db, type ModelStage } from '@thinkmade/db';
import { createEmailSender, createEmbedder, createLlm, createStorage, createLocalStorage, createStt, memoryEmailSender, type EmailSender, type Embedder, type LlmClient, type ObjectStorage, type SttEngine } from '@thinkmade/ai';
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
  /** Sends and records the outcome in email_delivery, so failures are visible to administrators. */
  sendEmail: (message: { to: string; subject: string; text: string }, kind: string) => Promise<{ ok: boolean; error?: string }>;
  settings: SettingsService;
  storage: ObjectStorage;
  stt: SttEngine | null;
  /** Language model for a stage, as configured by administrators. */
  llm: (stage: ModelStage) => Promise<LlmClient>;
  /** Text embedder for search vectors, as configured by administrators. */
  embedder: () => Promise<Embedder>;
  /** The built web app's index.html, for server-rendered share pages. */
  indexHtml: () => Promise<string>;
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

declare const __THINKMADE_INDEX_HTML__: string | undefined;

const FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>ThinkMade</title><meta name="description" content="" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /></head><body><div id="root"></div></body></html>`;

/** The bundled index.html on Vercel; the built file locally; a minimal page otherwise. */
async function loadIndexHtml(): Promise<string> {
  if (typeof __THINKMADE_INDEX_HTML__ === 'string') return __THINKMADE_INDEX_HTML__;
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(new URL('../../web/dist/index.html', import.meta.url), 'utf8');
  } catch {
    return FALLBACK_HTML;
  }
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
  const email = options.email ?? (env.NODE_ENV === 'test' ? memoryEmailSender() : createEmailSender({ ...process.env, NODE_ENV: env.NODE_ENV }));
  const sendEmail: AppContext['sendEmail'] = async (message, kind) => {
    const r = await email.send(message);
    await handle.db
      .insert(schema.emailDelivery)
      .values({ to: message.to, subject: message.subject, kind, provider: email.provider, status: r.ok ? 'sent' : 'failed', providerId: r.ok ? r.id : null, error: r.ok ? null : r.error })
      .catch(() => {});
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
  const rawEnv = { ...process.env, NODE_ENV: env.NODE_ENV };
  const storage = options.storageDir ? createLocalStorage(options.storageDir) : createStorage(rawEnv);
  const loggedAuthEmail: EmailSender = {
    provider: email.provider,
    send: async (m) => {
      const r = await sendEmail(m, 'auth');
      return r.ok ? { ok: true, id: 'logged' } : { ok: false, error: r.error ?? 'failed' };
    },
  };
  const auth = createAuth({ db: handle.db, env, email: loggedAuthEmail, storage });
  const settings = createSettingsService(handle.db);
  await settings.seedDefaults();
  const stt = createStt(rawEnv);

  // Without DATABASE_URL the database is embedded and single-process, so jobs must run here.
  let worker: InProcessWorker | null = null;
  let loop: { poke: () => void; stop: () => Promise<void> } | null = null;
  if (options.inProcessWorker ?? !env.DATABASE_URL) {
    const { createWorkerDeps, startWorker } = await import('@thinkmade/worker');
    worker = await createWorkerDeps(handle.db, rawEnv, {
      storage,
      notifyAdmins: async (subject, text) => {
        const to = (await settings.getActive()).settings.bugReports.email;
        return to ? (await sendEmail({ to, subject, text }, 'quality_hold')).ok : false;
      },
    });
    const embedded = options.embeddedWorker ?? (env.NODE_ENV !== 'test' || process.env.EMBEDDED_WORKER === 'true');
    if (embedded) loop = startWorker(worker);
  }

  return {
    db: handle.db,
    dbKind: handle.kind,
    auth,
    env,
    email,
    sendEmail,
    settings,
    storage,
    stt,
    llm: async (stage) => {
      const { DEFAULT_LLM_PROVIDER: provider, DEFAULT_LLM_MODEL: model } = process.env;
      const override = provider && model ? { provider, model } : null;
      const cfg = (await getStageModel(handle.db, stage)) ?? defaultStageModel(stage, override);
      return createLlm(cfg, rawEnv);
    },
    embedder: async () => createEmbedder(await getStageModel(handle.db, 'embed'), rawEnv),
    indexHtml: loadIndexHtml,
    worker,
    pokeWorker: () => loop?.poke(),
    now: () => new Date(),
    close: async () => {
      await loop?.stop();
      await handle.close();
    },
  };
}
