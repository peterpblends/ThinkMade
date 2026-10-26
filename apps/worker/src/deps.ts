import type { BookClaim, BookVerification, Embedder, LlmClient, ObjectStorage, SttEngine, TtsEngine } from '@thinkmade/ai';
import type { Db, ModelStage } from '@thinkmade/db';

export interface WorkerDeps {
  db: Db;
  /** Language model for a pipeline stage, chosen by the admin model configuration. */
  llm: (stage: ModelStage) => Promise<LlmClient>;
  tts: TtsEngine;
  /** Speech-to-text for video soundtracks; null when no service is configured. */
  stt?: SttEngine | null;
  /** For search vectors of public series. */
  embedder?: Embedder;
  /** Emails administrators; resolves true only if a message was actually sent. */
  notifyAdmins?: (subject: string, text: string) => Promise<boolean>;
  storage: ObjectStorage;
  verifyBook: (claim: BookClaim) => Promise<BookVerification>;
  workDir: string;
  workerId: string;
  leaseSeconds?: number;
  /** How often a running job checks whether it was cancelled (milliseconds). */
  cancelPollMs?: number;
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

/** This worker's lease was taken over by another worker; it must stop without writing. */
export class LostLeaseError extends Error {
  constructor() {
    super('Lease lost to another worker');
    this.name = 'LostLeaseError';
  }
}
