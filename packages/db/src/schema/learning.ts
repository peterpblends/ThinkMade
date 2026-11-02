import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, uniqueIndex, vector } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers';
import { user } from './auth';

/** The user's input and the AI's understanding of what they want to learn. */
export const learningRequest = pgTable(
  'learning_request',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inputText: text('input_text'),
    inputTranscript: text('input_transcript'),
    mediaUploadIds: jsonb('media_upload_ids').notNull().$type<string[]>().default([]),
    objective: text('objective'),
    understanding: jsonb('understanding').$type<Record<string, unknown>>(),
    learningMode: text('learning_mode').notNull().default('explore'),
    customization: jsonb('customization').notNull().$type<Record<string, unknown>>().default({}),
    parentRequestId: text('parent_request_id'),
    /** Continued learning: the series this request builds on. */
    parentSeriesId: text('parent_series_id'),
    /** Topic update: look for newer verified material than the parent series. */
    updateMode: boolean('update_mode').notNull().default(false),
    coachingSessionId: text('coaching_session_id'),
    createdAt: createdAt(),
  },
  (t) => [index('learning_request_user_idx').on(t.userId)],
);

export const mentalModel = pgTable(
  'mental_model',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    summary: text('summary').notNull(),
    category: text('category'),
    embedding: vector('embedding', { dimensions: 512 }),
    // Which embedder made `embedding`. Vectors from different models are never compared.
    embeddingModel: text('embedding_model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('mental_model_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))],
);

export const mentalModelRelation = pgTable(
  'mental_model_relation',
  {
    id: id(),
    fromModelId: text('from_model_id')
      .notNull()
      .references(() => mentalModel.id, { onDelete: 'cascade' }),
    toModelId: text('to_model_id')
      .notNull()
      .references(() => mentalModel.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull(), // complementary | contrasting | prerequisite | related
    note: text('note'),
  },
  (t) => [uniqueIndex('mental_model_relation_uq').on(t.fromModelId, t.toModelId, t.relation)],
);

export const author = pgTable('author', {
  id: id(),
  name: text('name').notNull(),
  openLibraryId: text('open_library_id'),
  wikidataId: text('wikidata_id'),
  createdAt: createdAt(),
});

export const book = pgTable(
  'book',
  {
    id: id(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    isbn13: text('isbn13'),
    openLibraryId: text('open_library_id'),
    googleBooksId: text('google_books_id'),
    firstPublishYear: integer('first_publish_year'),
    verificationStatus: text('verification_status').notNull().default('unverified'), // verified | unverified | rejected
    verifiedVia: text('verified_via'),
    verifiedAt: tz('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [index('book_title_idx').on(t.title)],
);

export const bookAuthor = pgTable(
  'book_author',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => author.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('book_author_uq').on(t.bookId, t.authorId)],
);

export const source = pgTable('source', {
  id: id(),
  kind: text('kind').notNull(), // book | article | paper | web | other
  title: text('title').notNull(),
  url: text('url'),
  bookId: text('book_id').references(() => book.id, { onDelete: 'set null' }),
  publisher: text('publisher'),
  year: integer('year'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  verifiedVia: text('verified_via'),
  verifiedAt: tz('verified_at'),
  createdAt: createdAt(),
});

export const podcastSeries = pgTable(
  'podcast_series',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    learningRequestId: text('learning_request_id')
      .notNull()
      .references(() => learningRequest.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    coverKey: text('cover_key'),
    visibility: text('visibility').notNull().default('private'),
    publicSlug: text('public_slug').unique(),
    status: text('status').notNull().default('pending'), // pending | generating | ready | partial | failed
    /** The language the series was made in, and the one it is shown in now (the owner can switch). */
    originalLanguage: text('original_language').notNull().default('en'),
    language: text('language').notNull().default('en'),
    embedding: vector('embedding', { dimensions: 512 }),
    // Which embedder made `embedding`. Vectors from different models are never compared.
    embeddingModel: text('embedding_model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('podcast_series_user_idx').on(t.userId),
    index('podcast_series_visibility_idx').on(t.visibility),
    index('podcast_series_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const episode = pgTable(
  'episode',
  {
    id: id(),
    seriesId: text('series_id')
      .notNull()
      .references(() => podcastSeries.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    learningObjective: text('learning_objective'),
    primaryMentalModelId: text('primary_mental_model_id').references(() => mentalModel.id, {
      onDelete: 'set null',
    }),
    speakerFormat: text('speaker_format').notNull().default('single'),
    plannedMinutes: integer('planned_minutes'),
    durationSeconds: real('duration_seconds'),
    status: text('status').notNull().default('pending'), // pending | scripting | validating | synthesizing | ready | needs_review | failed
    outcomes: jsonb('outcomes').$type<{ thinking: string; seeing: string; doing: string }>(),
    keyTakeaways: jsonb('key_takeaways').notNull().$type<string[]>().default([]),
    examples: jsonb('examples').notNull().$type<Array<Record<string, unknown>>>().default([]),
    script: jsonb('script').$type<Array<{ speaker: string; text: string }>>(),
    hosts: jsonb('hosts').$type<Array<{ id: string; name: string; voice: string; age?: number; role?: string; kind?: 'host' | 'guest'; simulated?: boolean }>>(),
    transcript: text('transcript'),
    audioKey: text('audio_key'),
    audioBytes: integer('audio_bytes'),
    coverKey: text('cover_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('episode_series_number_uq').on(t.seriesId, t.number)],
);

/** A series' title and description in another language. */
export const seriesTranslation = pgTable(
  'series_translation',
  {
    seriesId: text('series_id')
      .notNull()
      .references(() => podcastSeries.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.language] })],
);

/**
 * An episode in another language: its text straight away, then its script and audio once the worker has
 * voiced it. status: voicing (text only so far) | ready | failed.
 */
export const episodeTranslation = pgTable(
  'episode_translation',
  {
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    learningObjective: text('learning_objective'),
    outcomes: jsonb('outcomes').$type<{ thinking: string; seeing: string; doing: string }>(),
    keyTakeaways: jsonb('key_takeaways').notNull().$type<string[]>().default([]),
    examples: jsonb('examples').notNull().$type<Array<Record<string, unknown>>>().default([]),
    script: jsonb('script').$type<Array<{ speaker: string; text: string }>>(),
    transcript: text('transcript'),
    hosts: jsonb('hosts').$type<Array<{ id: string; name: string; voice: string }>>(),
    audioKey: text('audio_key'),
    audioBytes: integer('audio_bytes'),
    durationSeconds: real('duration_seconds'),
    status: text('status').notNull().default('voicing'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.episodeId, t.language] })],
);

export const episodeMentalModel = pgTable(
  'episode_mental_model',
  {
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    mentalModelId: text('mental_model_id')
      .notNull()
      .references(() => mentalModel.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('supporting'), // primary | supporting
  },
  (t) => [uniqueIndex('episode_mental_model_uq').on(t.episodeId, t.mentalModelId)],
);

export const episodeSource = pgTable(
  'episode_source',
  {
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    note: text('note'),
  },
  (t) => [uniqueIndex('episode_source_uq').on(t.episodeId, t.sourceId)],
);

export const episodeQualityCheck = pgTable(
  'episode_quality_check',
  {
    id: id(),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    passed: integer('passed').notNull(), // 0/1 kept as int for sum() convenience
    scores: jsonb('scores').notNull().$type<Record<string, number>>(),
    notes: jsonb('notes').notNull().$type<string[]>().default([]),
    checkedBy: text('checked_by').notNull().default('auto'), // auto | human
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('episode_quality_check_uq').on(t.episodeId, t.revision)],
);
