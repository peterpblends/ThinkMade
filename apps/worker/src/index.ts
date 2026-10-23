import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  createKokoroTts,
  createLlm,
  createStorage,
  createEmailSender,
  createEmbedder,
  createStt,
  createToneTts,
  setFakeResponder,
  verifyBook,
  type TtsEngine,
} from '@thinkmade/ai';
import { defaultStageModel, getActiveAppSettings, getStageModel, schema, seedModelConfig, type Db } from '@thinkmade/db';
import type { WorkerDeps } from './deps';
import { runJob } from './pipeline';
import { claimNextJob } from './queue';
import { cleanupExpiredUploads } from './media';
import { fakeResponder, fakeVerifyBook } from './testing/fake-responder';

export { runJob } from './pipeline';
export { cleanupExpiredUploads } from './media';
export { claimNextJob } from './queue';
export type { WorkerDeps } from './deps';
export { fakeResponder, fakeVerifyBook, setFakeValidation } from './testing/fake-responder';

type Env = Record<string, string | undefined>;

/** One model for every stage from env (a local model, or fake in tests); null means the free per-stage defaults. */
export function defaultModel(env: Env): { provider: string; model: string } | null {
  if (env.DEFAULT_LLM_PROVIDER && env.DEFAULT_LLM_MODEL) return { provider: env.DEFAULT_LLM_PROVIDER, model: env.DEFAULT_LLM_MODEL };
  if (env.DEFAULT_LLM_PROVIDER === 'fake' || (!env.DEFAULT_LLM_PROVIDER && env.NODE_ENV === 'test')) return { provider: 'fake', model: 'fake' };
  return null;
}

export function createTts(env: Env): TtsEngine {
  const provider = env.TTS_PROVIDER ?? (env.NODE_ENV === 'test' ? 'tone' : 'kokoro');
  if (provider === 'tone') {
    if (env.NODE_ENV === 'production') throw new Error('The tone test voice is not allowed in production.');
    return createToneTts();
  }
  return createKokoroTts({ dtype: (env.KOKORO_DTYPE as 'q8' | 'fp32' | undefined) ?? 'q8' });
}

/** Builds worker dependencies from environment variables. */
export async function createWorkerDeps(db: Db, env: Env = process.env, overrides: Partial<WorkerDeps> = {}): Promise<WorkerDeps> {
  const fake = env.NODE_ENV !== 'production' && (env.DEFAULT_LLM_PROVIDER === 'fake' || (!env.DEFAULT_LLM_PROVIDER && env.NODE_ENV === 'test'));
  if (fake) setFakeResponder(fakeResponder);
  await seedModelConfig(db, defaultModel(env));
  return {
    db,
    llm: async (stage) => {
      const cfg = (await getStageModel(db, stage)) ?? defaultStageModel(stage, defaultModel(env));
      return createLlm(cfg, env);
    },
    tts: createTts(env),
    stt: createStt(env),
    embedder: createEmbedder(await getStageModel(db, 'embed'), env),
    notifyAdmins: async (subject, text) => {
      const to = (await getActiveAppSettings(db)).bugReports.email;
      if (!to || env.NODE_ENV === 'test') return false;
      const sender = createEmailSender(env);
      const r = await sender.send({ to, subject, text });
      await db
        .insert(schema.emailDelivery)
        .values({ to, subject, kind: 'quality_hold', provider: sender.provider, status: r.ok ? 'sent' : 'failed', providerId: r.ok ? r.id : null, error: r.ok ? null : r.error })
        .catch(() => {});
      return r.ok;
    },
    storage: createStorage(env),
    verifyBook: env.BOOK_VERIFIER === 'fake' || (fake && env.BOOK_VERIFIER !== 'live') ? fakeVerifyBook : (claim) => verifyBook(claim),
    workDir: env.WORK_DIR ?? join('.data', 'work'),
    workerId: `${hostname()}:${process.pid}`,
    leaseSeconds: 600,
    log: (message, extra) => console.info(`[worker] ${message}`, extra ?? ''),
    ...overrides,
  };
}

/** Claims and runs one job. Returns false when the queue is empty. */
export async function runNextJob(deps: WorkerDeps): Promise<boolean> {
  const settings = await getActiveAppSettings(deps.db);
  const job = await claimNextJob(deps.db, deps.workerId, { leaseSeconds: deps.leaseSeconds ?? 600, concurrency: settings.limits.generationConcurrency });
  if (!job) return false;
  await runJob(job, deps);
  return true;
}

/** Polls the queue until stopped. Runs jobs one at a time per worker process. */
export function startWorker(deps: WorkerDeps, opts: { pollMs?: number } = {}) {
  let stopped = false;
  let wake: (() => void) | null = null;
  let lastCleanup = 0;
  const loop = (async () => {
    while (!stopped) {
      if (Date.now() - lastCleanup > 30 * 60_000) {
        lastCleanup = Date.now();
        await cleanupExpiredUploads(deps).catch((err) => deps.log?.('cleanup failed', { message: String(err) }));
      }
      let worked = false;
      try {
        worked = await runNextJob(deps);
      } catch (err) {
        deps.log?.('worker loop error', { message: err instanceof Error ? err.message : String(err) });
      }
      if (!worked && !stopped) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, opts.pollMs ?? 2000);
        });
        wake = null;
      }
    }
  })();
  return {
    /** Ask the loop to check the queue now (e.g. right after a job is created in-process). */
    poke: () => wake?.(),
    stop: async () => {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
