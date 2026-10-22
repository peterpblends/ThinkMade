import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { buffer } from 'node:stream/consumers';
import { join } from 'node:path';
import { and, eq, lt, ne } from 'drizzle-orm';
import { completeJson, extractAudioForTranscription, extractKeyFrames, imageForVision, probeMedia, sniffMediaType, type ChatContentPart } from '@thinkmade/ai';
import { getActiveAppSettings, getActivePrompts, schema } from '@thinkmade/db';
import type { WorkerDeps } from './deps';
import { input, stageSystem } from './prompts';

import { mediaAnalysisSchema, VISION_TASK } from '@thinkmade/shared';
export { mediaAnalysisSchema, VISION_TASK } from '@thinkmade/shared';
import type { z } from 'zod';

export interface MediaAnalysis extends z.infer<typeof mediaAnalysisSchema> {
  kind: 'image' | 'video';
  transcript?: string;
  durationSeconds?: number;
}

const MAX_FRAMES = 6;

/**
 * Analyses each attached upload. Returns analyses for valid media; marks anything that fails its
 * content check, length limit or decoding as rejected (with a note) and carries on with the rest.
 */
export async function analyseUploads(deps: WorkerDeps, uploadIds: string[], question: string, onTokens: (n: number) => void): Promise<{ analyses: MediaAnalysis[]; notes: string[] }> {
  const settings = await getActiveAppSettings(deps.db);
  const visionTask = (await getActivePrompts(deps.db)).get('vision') ?? VISION_TASK;
  const analyses: MediaAnalysis[] = [];
  const notes: string[] = [];
  mkdirSync(deps.workDir, { recursive: true });
  const work = mkdtempSync(join(deps.workDir, 'media-'));
  try {
    for (const id of uploadIds) {
      const [row] = await deps.db.select().from(schema.mediaUpload).where(eq(schema.mediaUpload.id, id));
      if (!row || row.status === 'deleted' || row.status === 'rejected') continue;
      if (row.status === 'validated' && row.analysis) {
        analyses.push(row.analysis as unknown as MediaAnalysis);
        continue;
      }
      const reject = async (why: string) => {
        notes.push(why);
        await deps.db.update(schema.mediaUpload).set({ status: 'rejected', analysis: { rejected: why } }).where(eq(schema.mediaUpload.id, id));
        await deps.storage.delete(row.objectKey).catch(() => {});
      };
      let bytes: Buffer;
      try {
        bytes = await buffer((await deps.storage.get(row.objectKey)).stream);
      } catch {
        await reject('An uploaded file could not be found.');
        continue;
      }
      const sniffed = sniffMediaType(bytes);
      if (!sniffed) {
        await reject('An uploaded file was not a real photo or video and was ignored.');
        continue;
      }
      try {
        const llm = await deps.llm('vision');
        let content: ChatContentPart[];
        let extra: Partial<MediaAnalysis> = {};
        if (sniffed.kind === 'image') {
          const jpeg = await imageForVision(bytes, work);
          content = [{ type: 'text', text: input({ question, media: 'one photo' }) }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }];
        } else {
          const path = join(work, `${id}.video`);
          writeFileSync(path, bytes);
          const info = await probeMedia(path);
          if (info.durationSeconds > settings.media.maxVideoSeconds + 1) {
            await reject(`A video was longer than the ${settings.media.maxVideoSeconds}-second limit and was ignored.`);
            continue;
          }
          let transcript = '';
          if (info.hasAudio && deps.stt) {
            const wav = await extractAudioForTranscription(path, work);
            transcript = (await deps.stt.transcribe(wav, { filename: 'speech.wav', contentType: 'audio/wav', language: 'en' })).text;
          } else if (info.hasAudio) {
            notes.push('Speech in a video could not be transcribed because no transcription service is configured.');
          }
          const frames = info.hasVideo ? await extractKeyFrames(path, { workDir: work, maxFrames: MAX_FRAMES }) : [];
          content = [
            { type: 'text', text: input({ question, media: `${frames.length} frames from a ${Math.round(info.durationSeconds)}-second video, in order`, frameTimesSeconds: frames.map((f) => Math.round(f.atSeconds)), transcript }) },
            ...frames.map((f) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${f.jpeg.toString('base64')}` } })),
          ];
          extra = { ...(transcript ? { transcript } : {}), durationSeconds: info.durationSeconds };
          rmSync(path, { force: true });
        }
        const res = await completeJson(llm, [{ role: 'system', content: stageSystem('vision', visionTask) }, { role: 'user', content }], mediaAnalysisSchema, { temperature: 0.2, maxTokens: 1500 });
        onTokens(res.usage.promptTokens + res.usage.completionTokens);
        const analysis: MediaAnalysis = { kind: sniffed.kind, ...res.data, ...extra };
        await deps.db.update(schema.mediaUpload).set({ status: 'validated', analysis: analysis as unknown as Record<string, unknown> }).where(eq(schema.mediaUpload.id, id));
        analyses.push(analysis);
      } catch (err) {
        if (err instanceof Error && /ffmpeg exited/.test(err.message)) {
          await reject('An uploaded file could not be read and was ignored.');
          continue;
        }
        throw err;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { analyses, notes };
}

/** Deletes uploads past their retention date. Returns how many were removed. */
export async function cleanupExpiredUploads(deps: Pick<WorkerDeps, 'db' | 'storage'>, now = new Date()): Promise<number> {
  const expired = await deps.db
    .select({ id: schema.mediaUpload.id, key: schema.mediaUpload.objectKey })
    .from(schema.mediaUpload)
    .where(and(lt(schema.mediaUpload.retentionExpiresAt, now), ne(schema.mediaUpload.status, 'deleted')));
  for (const u of expired) {
    await deps.storage.delete(u.key).catch(() => {});
    await deps.db.update(schema.mediaUpload).set({ status: 'deleted', analysis: null }).where(eq(schema.mediaUpload.id, u.id));
  }
  return expired.length;
}
