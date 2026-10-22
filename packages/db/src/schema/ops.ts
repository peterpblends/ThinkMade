import { index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers';
import { user } from './auth';
import { learningRequest, podcastSeries } from './learning';

export const generationJob = pgTable(
  'generation_job',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    learningRequestId: text('learning_request_id')
      .notNull()
      .references(() => learningRequest.id, { onDelete: 'cascade' }),
    seriesId: text('series_id').references(() => podcastSeries.id, { onDelete: 'set null' }),
    queueJobId: text('queue_job_id'),
    status: text('status').notNull().default('queued'), // queued | running | succeeded | partial | failed | cancelled
    currentStage: text('current_stage'),
    error: text('error'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    audioSecondsGenerated: real('audio_seconds_generated').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd').notNull().default(0),
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('generation_job_user_idx').on(t.userId), index('generation_job_status_idx').on(t.status)],
);

export const generationStage = pgTable(
  'generation_stage',
  {
    id: id(),
    jobId: text('job_id')
      .notNull()
      .references(() => generationJob.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    episodeNumber: integer('episode_number'),
    status: text('status').notNull().default('pending'), // pending | running | done | failed | skipped
    note: text('note'),
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
  },
  (t) => [index('generation_stage_job_idx').on(t.jobId)],
);

export const mediaUpload = pgTable(
  'media_upload',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // image | video | audio
    objectKey: text('object_key').notNull().unique(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes'),
    status: text('status').notNull().default('pending'), // pending | uploaded | validated | rejected | deleted
    analysis: jsonb('analysis').$type<Record<string, unknown>>(),
    retentionExpiresAt: tz('retention_expires_at'),
    createdAt: createdAt(),
  },
  (t) => [index('media_upload_user_idx').on(t.userId)],
);

export const bugReport = pgTable(
  'bug_report',
  {
    id: id(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    screenshotKey: text('screenshot_key'),
    diagnostics: jsonb('diagnostics').notNull().$type<Record<string, unknown>>().default({}),
    status: text('status').notNull().default('new'), // new | in_progress | resolved | closed
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('bug_report_status_idx').on(t.status)],
);

export const emailDelivery = pgTable('email_delivery', {
  id: id(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  kind: text('kind').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull(), // sent | failed
  providerId: text('provider_id'),
  error: text('error'),
  createdAt: createdAt(),
});

export const usageMetric = pgTable(
  'usage_metric',
  {
    id: id(),
    metric: text('metric').notNull(), // llm_tokens | tts_seconds | storage_bytes | ...
    provider: text('provider'),
    value: real('value').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    jobId: text('job_id'),
    recordedAt: createdAt(),
  },
  (t) => [index('usage_metric_metric_idx').on(t.metric, t.recordedAt)],
);

/** Fixed-window rate limiting shared across serverless instances. */
export const rateLimit = pgTable('rate_limit', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});
