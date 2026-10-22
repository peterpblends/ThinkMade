import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, tz } from './_helpers';
import { user } from './auth';

/** Versioned configuration documents. Exactly one active version per name. */
export const appSetting = pgTable(
  'app_setting',
  {
    id: id(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    document: jsonb('document').notNull().$type<Record<string, unknown>>(),
    active: boolean('active').notNull().default(false),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('app_setting_name_version_uq').on(t.name, t.version),
    uniqueIndex('app_setting_one_active_uq').on(t.name).where(sql`${t.active} = true`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt), index('audit_log_actor_idx').on(t.actorId)],
);

/** Per-stage AI model selection. Edited from the admin dashboard; versioned through app_setting history. */
export const aiModelConfig = pgTable(
  'ai_model_config',
  {
    id: id(),
    stage: text('stage').notNull().unique(), // understand | select_models | research | plan | script | validate | coach | vision | stt | tts | embed
    provider: text('provider').notNull(), // groq | openrouter | ollama | gemini | kokoro | local-whisper | ...
    model: text('model').notNull(),
    params: jsonb('params').notNull().$type<Record<string, unknown>>().default({}),
    promptVersionId: text('prompt_version_id'),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
);

export const promptVersion = pgTable(
  'prompt_version',
  {
    id: id(),
    stage: text('stage').notNull(),
    version: integer('version').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    userTemplate: text('user_template').notNull(),
    active: boolean('active').notNull().default(false),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('prompt_version_stage_version_uq').on(t.stage, t.version),
    uniqueIndex('prompt_version_one_active_uq').on(t.stage).where(sql`${t.active} = true`),
  ],
);
