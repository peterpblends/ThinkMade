import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createFakeStt, runFfmpeg, textOf, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { cleanupExpiredUploads, runNextJob } from './index';
import { fakeResponder } from './testing/fake-responder';
import { makeWorld } from './testing/fixtures';

let world: Awaited<ReturnType<typeof makeWorld>> | undefined;
const tmp = mkdtempSync(join(tmpdir(), 'tm-wmedia-'));
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

async function makeVideo() {
  const out = join(tmp, 'v.mp4');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=2', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return readFileSync(out);
}

async function makePng() {
  const out = join(tmp, 'p.png');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x480:d=1', '-frames:v', '1', out]);
  return readFileSync(out);
}

describe('photo and video understanding', () => {
  it('analyses a photo and a video and feeds evidence into understanding', async () => {
    const visionInputs: ChatMessage[][] = [];
    let understandInput = '';
    world = await makeWorld((messages) => {
      const sys = textOf(messages[0]!.content);
      if (sys.startsWith('STAGE: vision')) visionInputs.push(messages);
      if (sys.startsWith('STAGE: understand')) understandInput = textOf(messages[1]!.content);
      return fakeResponder(messages);
    });
    world.deps.stt = createFakeStt('We keep missing deadlines on this production line.');
    const photoKey = 'uploads/u1/p.png';
    const videoKey = 'uploads/u1/v.mp4';
    await world.storage.put(photoKey, await makePng(), 'image/png');
    await world.storage.put(videoKey, await makeVideo(), 'video/mp4');
    const [p] = await world.db.insert(schema.mediaUpload).values({ userId: 'u1', kind: 'image', objectKey: photoKey, contentType: 'image/png', status: 'uploaded' }).returning();
    const [v] = await world.db.insert(schema.mediaUpload).values({ userId: 'u1', kind: 'video', objectKey: videoKey, contentType: 'video/mp4', status: 'uploaded' }).returning();
    const job = await world.enqueue('How should I think about improving this operation?', { episodes: 1 });
    await world.db.update(schema.learningRequest).set({ mediaUploadIds: [p!.id, v!.id] }).where(eq(schema.learningRequest.id, job.learningRequestId));

    await runNextJob(world.deps);
    const [j] = await world.db.select().from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
    expect(j!.status, j!.error ?? '').toBe('succeeded');

    // One vision call for the photo, one for the video's key frames; images sent as data URLs.
    expect(visionInputs).toHaveLength(2);
    const parts = visionInputs.map((m) => (m[1]!.content as Array<{ type: string }>).filter((x) => x.type === 'image_url').length);
    expect(parts[0]).toBe(1);
    expect(parts[1]).toBeGreaterThanOrEqual(2);

    const uploads = await world.db.select().from(schema.mediaUpload);
    for (const u of uploads) {
      expect(u.status).toBe('validated');
      expect(u.analysis).toMatchObject({ visibleEvidence: expect.any(Array), assumptions: expect.any(Array) });
    }
    expect(uploads.find((u) => u.kind === 'video')!.analysis).toMatchObject({ transcript: 'We keep missing deadlines on this production line.' });
    expect(understandInput).toContain('We keep missing deadlines on this production line.');
    expect(understandInput).toContain('visibleEvidence');
  });

  it('rejects an upload whose stored bytes are not real media, and says so', async () => {
    world = await makeWorld();
    await world.storage.put('uploads/u1/bad.png', Buffer.from('MZ fake executable'.padEnd(64)), 'image/png');
    const [u] = await world.db.insert(schema.mediaUpload).values({ userId: 'u1', kind: 'image', objectKey: 'uploads/u1/bad.png', contentType: 'image/png', status: 'uploaded' }).returning();
    const job = await world.enqueue('Look at this', { episodes: 1 });
    await world.db.update(schema.learningRequest).set({ mediaUploadIds: [u!.id] }).where(eq(schema.learningRequest.id, job.learningRequestId));
    await runNextJob(world.deps);
    const [row] = await world.db.select().from(schema.mediaUpload);
    expect(row!.status).toBe('rejected');
    const [j] = await world.db.select().from(schema.generationJob);
    expect(j!.status).toBe('succeeded'); // the text question still works
  });

  it('deletes uploads past their retention date', async () => {
    world = await makeWorld();
    await world.storage.put('uploads/u1/old.png', await makePng(), 'image/png');
    await world.db.insert(schema.mediaUpload).values({ userId: 'u1', kind: 'image', objectKey: 'uploads/u1/old.png', contentType: 'image/png', status: 'validated', retentionExpiresAt: new Date(Date.now() - 1000) });
    const removed = await cleanupExpiredUploads(world.deps);
    expect(removed).toBe(1);
    expect(await world.storage.head('uploads/u1/old.png')).toBeNull();
    const [row] = await world.db.select().from(schema.mediaUpload);
    expect(row!.status).toBe('deleted');
  });
});

afterEach(() => {});
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
