import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers';
import { user } from './auth';
import { episode, podcastSeries } from './learning';

export const libraryItem = pgTable(
  'library_item',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seriesId: text('series_id')
      .notNull()
      .references(() => podcastSeries.id, { onDelete: 'cascade' }),
    addedAt: createdAt(),
  },
  (t) => [uniqueIndex('library_item_uq').on(t.userId, t.seriesId)],
);

export const playbackState = pgTable(
  'playback_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    positionMs: integer('position_ms').notNull().default(0),
    status: text('status').notNull().default('not_started'), // not_started | in_progress | completed
    manualStatus: boolean('manual_status').notNull().default(false),
    deviceId: text('device_id'),
    clientUpdatedAt: tz('client_updated_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('playback_state_uq').on(t.userId, t.episodeId)],
);

export const favorite = pgTable(
  'favorite',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('favorite_uq').on(t.userId, t.episodeId)],
);

export const rating = pgTable(
  'rating',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('rating_uq').on(t.userId, t.episodeId)],
);

/** What a device reported it holds offline. */
export const downloadManifest = pgTable(
  'download_manifest',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    episodeIds: jsonb('episode_ids').notNull().$type<string[]>().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('download_manifest_uq').on(t.userId, t.deviceId)],
);

/** Append-only client events for offline synchronisation. */
export const syncEvent = pgTable(
  'sync_event',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(), // progress | status | favorite | rating | library
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    clientAt: tz('client_at').notNull(),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex('sync_event_uq').on(t.userId, t.deviceId, t.sequence)],
);

export const coachingSession = pgTable(
  'coaching_session',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('coaching_session_user_idx').on(t.userId)],
);

export const coachingMessage = pgTable(
  'coaching_message',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => coachingSession.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | coach
    content: text('content').notNull(),
    audioKey: text('audio_key'),
    createdAt: createdAt(),
  },
  (t) => [index('coaching_message_session_idx').on(t.sessionId)],
);
