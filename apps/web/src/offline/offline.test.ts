import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetOfflineDb } from './db';
import { downloadEpisode, isMp3, listDownloads, removeDownload } from './downloads';
import { flushOutbox, queueFavorite, queueProgress, localPlayback } from './sync';

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...new Array(2000).fill(1)]);
const meta = { id: 'e1', seriesId: 's1', title: 'Opportunity cost', seriesTitle: 'Series', number: 1, primaryModelName: 'Opportunity Cost', durationSeconds: 300, audioUrl: '/api/episodes/e1/audio' };

beforeEach(async () => {
  await resetOfflineDb();
});
afterEach(() => vi.unstubAllGlobals());

describe('downloads', () => {
  it('recognises MP3 data', () => {
    expect(isMp3(MP3)).toBe(true);
    expect(isMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
    expect(isMp3(new TextEncoder().encode('<html>error</html>'))).toBe(false);
  });

  it('stores a verified download with the episode details for offline use', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': String(MP3.length) } })));
    const res = await downloadEpisode(meta, { detail: { keyTakeaways: ['x'] }, verifyDecode: async () => 299 });
    expect(res).toEqual({ ok: true, bytes: MP3.length });
    const list = await listDownloads();
    expect(list).toEqual([expect.objectContaining({ episodeId: 'e1', verified: true, bytes: MP3.length, detail: { keyTakeaways: ['x'] } })]);
  });

  it('refuses a download that is not audio, is truncated, or does not decode to the right length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', { status: 200 })));
    expect(await downloadEpisode(meta, { verifyDecode: async () => 300 })).toMatchObject({ ok: false, reason: 'not_audio' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MP3, { status: 200, headers: { 'content-length': String(MP3.length + 500) } })));
    expect(await downloadEpisode(meta, { verifyDecode: async () => 300 })).toMatchObject({ ok: false, reason: 'incomplete' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MP3, { status: 200, headers: { 'content-length': String(MP3.length) } })));
    expect(await downloadEpisode(meta, { verifyDecode: async () => 40 })).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(await listDownloads()).toEqual([]);
  });

  it('removes a download', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MP3, { status: 200 })));
    await downloadEpisode(meta, { verifyDecode: async () => 300 });
    await removeDownload('e1');
    expect(await listDownloads()).toEqual([]);
  });
});

describe('offline progress and sync', () => {
  it('applies progress locally at once and queues it', async () => {
    await queueProgress('e1', { positionMs: 5000, event: 'progress', clientUpdatedAt: '2026-10-22T10:00:00.000Z', deviceId: 'd' }, 300_000);
    expect(await localPlayback('e1')).toMatchObject({ positionMs: 5000, status: 'in_progress' });
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps only the latest queued progress per episode', async () => {
    await queueProgress('e1', { positionMs: 5000, event: 'progress', clientUpdatedAt: '2026-10-22T10:00:00.000Z', deviceId: 'd' }, 300_000);
    await queueProgress('e1', { positionMs: 9000, event: 'progress', clientUpdatedAt: '2026-10-22T10:00:05.000Z', deviceId: 'd' }, 300_000);
    const items = await db.outbox.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]!.payload).toMatchObject({ positionMs: 9000 });
  });

  it('flushes in order when online and stops at a network failure', async () => {
    await queueProgress('e1', { positionMs: 5000, event: 'seek', clientUpdatedAt: '2026-10-22T10:00:00.000Z', deviceId: 'd' }, 300_000);
    await queueFavorite('e2', true);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('favorites')) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200 });
    }));
    const r = await flushOutbox();
    expect(calls).toEqual(['PUT /api/playback/e1', 'PUT /api/favorites/e2']);
    expect(r).toEqual({ sent: 1, remaining: 1 });
  });

  it('drops items the server rejects as invalid but keeps them on auth errors', async () => {
    await queueFavorite('gone', true);
    await queueFavorite('later', false);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('{}', { status: url.includes('gone') ? 404 : 401 })));
    const r = await flushOutbox();
    expect(r).toEqual({ sent: 0, remaining: 1 });
    expect((await db.outbox.toArray())[0]!.path).toContain('later');
  });
});

describe('outbox resilience', () => {
  it('gives up on an item the server keeps failing, so it cannot block everything behind it', async () => {
    await queueFavorite('broken', true);
    await queueFavorite('fine', true);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('{}', { status: url.includes('broken') ? 500 : 200 })));
    let r = { sent: 0, remaining: 2 };
    for (let i = 0; i < 10 && r.remaining > 0; i++) r = await flushOutbox();
    expect(r.remaining).toBe(0);
  });
});
