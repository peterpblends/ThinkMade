import Dexie, { type Table } from 'dexie';
import type { PlaybackRecord } from '@thinkmade/shared';

export interface DownloadRecord {
  episodeId: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  number: number;
  primaryModelName: string | null;
  durationSeconds: number | null;
  bytes: number;
  mime: string;
  blob: Blob;
  verified: boolean;
  downloadedAt: string;
  /** Episode details (takeaways, sources, transcript) so the player works offline. */
  detail: unknown;
}

export interface LocalPlayback extends PlaybackRecord {
  episodeId: string;
}

export interface OutboxItem {
  id?: number;
  /** Coalescing key: only the newest item per key is kept (e.g. progress per episode). */
  key: string;
  method: 'PUT' | 'DELETE';
  path: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
}

export interface LocalPref {
  episodeId: string;
  favorite?: boolean;
  rating?: number | null;
}

class OfflineDb extends Dexie {
  downloads!: Table<DownloadRecord, string>;
  playback!: Table<LocalPlayback, string>;
  outbox!: Table<OutboxItem, number>;
  prefs!: Table<LocalPref, string>;
  constructor() {
    super('thinkmade');
    this.version(1).stores({
      downloads: 'episodeId, seriesId, downloadedAt',
      playback: 'episodeId',
      outbox: '++id, key, createdAt',
      prefs: 'episodeId',
    });
  }
}

export const db = new OfflineDb();

export async function resetOfflineDb() {
  await Promise.all([db.downloads.clear(), db.playback.clear(), db.outbox.clear(), db.prefs.clear()]);
}
