import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpeg } from '../audio/ffmpeg';

export type MediaKind = 'image' | 'video';

/** Identifies a file by its leading bytes. Declared content types and file names are never trusted. */
export function sniffMediaType(buf: Buffer): { kind: MediaKind; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return { kind: 'image', mime: 'image/heic' };
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  return null;
}

export interface MediaInfo {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Reads container information from ffmpeg's own report (no ffprobe binary needed). */
export async function probeMedia(path: string, contents?: Buffer): Promise<MediaInfo> {
  if (contents) writeFileSync(path, contents);
  const log = await runFfmpeg(['-i', path, '-f', 'null', '-t', '0', '-']).catch((e: Error) => e.message);
  const d = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = log.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return {
    durationSeconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    width: v ? Number(v[1]) : null,
    height: v ? Number(v[2]) : null,
    hasAudio: /Stream #[^\n]*Audio:/.test(log),
    hasVideo: /Stream #[^\n]*Video:/.test(log),
  };
}

export interface KeyFrame {
  jpeg: Buffer;
  atSeconds: number;
}

/**
 * Picks frames where the scene changes, so one vision call sees what matters without paying for every second.
 * Falls back to evenly spaced frames when the video has few cuts.
 */
export async function extractKeyFrames(path: string, opts: { workDir: string; maxFrames: number; width?: number }): Promise<KeyFrame[]> {
  const info = await probeMedia(path);
  const out = mkdtempSync(join(opts.workDir, 'frames-'));
  const scale = `scale='min(${opts.width ?? 768},iw)':-2`;
  try {
    const log = await runFfmpeg([
      '-i', path, '-vf', `select='eq(n,0)+gt(scene,0.3)',${scale},showinfo`, '-vsync', 'vfr',
      '-frames:v', String(opts.maxFrames), '-q:v', '4', join(out, 's-%03d.jpg'),
    ]);
    let times = [...log.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    let files = readdirSync(out).filter((f) => f.endsWith('.jpg')).sort();
    if (files.length < Math.min(2, opts.maxFrames) && info.durationSeconds > 1) {
      for (const f of files) rmSync(join(out, f));
      const n = Math.min(opts.maxFrames, Math.max(2, Math.ceil(info.durationSeconds / 10)));
      times = Array.from({ length: n }, (_, i) => (info.durationSeconds * (i + 0.5)) / n);
      for (let i = 0; i < times.length; i++) {
        await runFfmpeg(['-ss', times[i]!.toFixed(2), '-i', path, '-frames:v', '1', '-vf', scale, '-q:v', '4', join(out, `e-${String(i).padStart(3, '0')}.jpg`)]);
      }
      files = readdirSync(out).filter((f) => f.endsWith('.jpg')).sort();
    }
    return files.map((f, i) => ({ jpeg: readFileSync(join(out, f)), atSeconds: times[i] ?? 0 }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Mono 16 kHz WAV, the format speech recognisers expect. */
export async function extractAudioForTranscription(path: string, workDir: string): Promise<Buffer> {
  const out = join(mkdtempSync(join(workDir, 'aud-')), 'speech.wav');
  try {
    await runFfmpeg(['-y', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
    return readFileSync(out);
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
}

/** Re-encodes any supported image to a modest JPEG for a vision model, which also strips metadata such as GPS. */
export async function imageForVision(image: Buffer, workDir: string, maxWidth = 1280): Promise<Buffer> {
  const dir = mkdtempSync(join(workDir, 'img-'));
  try {
    const src = join(dir, 'in');
    writeFileSync(src, image);
    const dst = join(dir, 'out.jpg');
    await runFfmpeg(['-y', '-i', src, '-vf', `scale='min(${maxWidth},iw)':-2`, '-frames:v', '1', '-map_metadata', '-1', '-q:v', '4', dst]);
    return readFileSync(dst);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
