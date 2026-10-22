import type { BookClaim, BookVerification, LlmClient, ObjectStorage, TtsEngine } from '@thinkmade/ai';
import type { Db, ModelStage } from '@thinkmade/db';

export interface WorkerDeps {
  db: Db;
  /** Language model for a pipeline stage, chosen by the admin model configuration. */
  llm: (stage: ModelStage) => Promise<LlmClient>;
  tts: TtsEngine;
  storage: ObjectStorage;
  verifyBook: (claim: BookClaim) => Promise<BookVerification>;
  workDir: string;
  workerId: string;
  leaseSeconds?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/** Errors that will not fix themselves on retry (bad configuration, invalid input). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super('Cancelled by the user');
    this.name = 'JobCancelledError';
  }
}
