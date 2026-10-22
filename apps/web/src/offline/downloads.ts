import { db, type DownloadRecord } from './db';

export interface DownloadableEpisode {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  number: number;
  primaryModelName: string | null;
  durationSeconds: number | null;
  audioUrl: string;
}

export type DownloadResult = { ok: true; bytes: number } | { ok: false; reason: 'offline' | 'http_error' | 'not_audio' | 'incomplete' | 'corrupt' | 'no_space' | 'storage_error'; message: string };

/** MP3 starts with an ID3 tag or an MPEG audio frame sync. */
export function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

/** Decodes the file in an audio element and returns its playing time. */
export function decodedDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const el = new Audio();
    el.preload = 'metadata';
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    el.onloadedmetadata = () => done(() => resolve(el.duration));
    el.onerror = () => done(() => reject(new Error('decode failed')));
    setTimeout(() => done(() => reject(new Error('decode timeout'))), 15_000);
    el.src = url;
  });
}

const MESSAGES: Record<string, string> = {
  offline: 'You are offline. Connect to download.',
  http_error: 'The episode could not be downloaded. Please try again.',
  not_audio: 'The download was not a valid audio file.',
  incomplete: 'The download was interrupted. Please try again.',
  corrupt: 'The downloaded audio could not be read. Please try again.',
  no_space: 'There is not enough storage space on this device.',
  storage_error: 'This device would not let ThinkMade save the file.',
};

const fail = (reason: Exclude<DownloadResult, { ok: true }>['reason']): DownloadResult => ({ ok: false, reason, message: MESSAGES[reason]! });

/**
 * Downloads an episode and only keeps it once it is proven playable: correct size, MP3 data,
 * and a decoded length that matches the episode.
 */
export async function downloadEpisode(ep: DownloadableEpisode, opts: { detail?: unknown; verifyDecode?: (b: Blob) => Promise<number> } = {}): Promise<DownloadResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('offline');
  let res: Response;
  try {
    res = await fetch(ep.audioUrl, { credentials: 'same-origin' });
  } catch {
    return fail('offline');
  }
  if (!res.ok) return fail('http_error');
  const expected = Number(res.headers.get('content-length') ?? 0);
  if (navigator.storage?.estimate && expected) {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (quota && quota - usage < expected * 1.2) return fail('no_space');
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (expected && buf.length !== expected) return fail('incomplete');
  if (!isMp3(buf)) return fail('not_audio');
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  try {
    const seconds = await (opts.verifyDecode ?? decodedDuration)(blob);
    if (ep.durationSeconds && Math.abs(seconds - ep.durationSeconds) > Math.max(3, ep.durationSeconds * 0.05)) return fail('corrupt');
  } catch {
    return fail('corrupt');
  }
  // Ask the browser not to evict downloads under storage pressure (it may still refuse).
  await navigator.storage?.persist?.().catch(() => false);
  const record: DownloadRecord = {
    episodeId: ep.id,
    seriesId: ep.seriesId,
    seriesTitle: ep.seriesTitle,
    title: ep.title,
    number: ep.number,
    primaryModelName: ep.primaryModelName,
    durationSeconds: ep.durationSeconds,
    bytes: buf.length,
    mime: 'audio/mpeg',
    blob,
    verified: true,
    downloadedAt: new Date().toISOString(),
    detail: opts.detail ?? null,
  };
  try {
    await db.downloads.put(record);
  } catch {
    return fail('storage_error');
  }
  return { ok: true, bytes: buf.length };
}

export async function listDownloads() {
  return db.downloads.orderBy('downloadedAt').reverse().toArray();
}

export async function getDownload(episodeId: string) {
  return db.downloads.get(episodeId);
}

export async function removeDownload(episodeId: string) {
  await db.downloads.delete(episodeId);
}

export async function removeAllDownloads() {
  await db.downloads.clear();
}

/** Drops records whose audio the browser has evicted, so the app never shows an unplayable download. */
export async function pruneEvictedDownloads(): Promise<number> {
  const all = await db.downloads.toArray();
  let removed = 0;
  for (const d of all) {
    if (!(d.blob instanceof Blob) || d.blob.size !== d.bytes) {
      await db.downloads.delete(d.episodeId);
      removed++;
    }
  }
  return removed;
}
