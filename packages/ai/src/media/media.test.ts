import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFfmpeg } from '../audio/ffmpeg';
import { extractAudioForTranscription, extractKeyFrames, imageForVision, probeMedia, sniffMediaType } from './media';

const dir = mkdtempSync(join(tmpdir(), 'tm-media-'));
const video = join(dir, 'clip.mp4');
const png = join(dir, 'still.png');

beforeAll(async () => {
  // A real 6-second video with two distinct scenes and a tone track, and a real PNG.
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video,
  ]);
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=s=2000x1500:d=1', '-frames:v', '1', png]);
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('sniffMediaType', () => {
  it('recognises real file signatures', () => {
    expect(sniffMediaType(readFileSync(png))).toEqual({ kind: 'image', mime: 'image/png' });
    expect(sniffMediaType(readFileSync(video))).toEqual({ kind: 'video', mime: 'video/mp4' });
    expect(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(sniffMediaType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toEqual({ kind: 'image', mime: 'image/webp' });
    expect(sniffMediaType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ kind: 'video', mime: 'video/webm' });
  });

  it('rejects anything else, including a script renamed to .jpg', () => {
    expect(sniffMediaType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMediaType(Buffer.from('MZ\x90\0'))).toBeNull();
    expect(sniffMediaType(Buffer.alloc(3))).toBeNull();
  });
});

describe('video processing', () => {
  it('probes duration and dimensions', async () => {
    const info = await probeMedia(video);
    expect(info.durationSeconds).toBeGreaterThan(5.5);
    expect(info.durationSeconds).toBeLessThan(6.5);
    expect(info.hasAudio).toBe(true);
    expect(info.width).toBe(320);
  });

  it('extracts distinct key frames, at most the requested number, as JPEG', async () => {
    const frames = await extractKeyFrames(video, { workDir: dir, maxFrames: 4 });
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.length).toBeLessThanOrEqual(4);
    for (const f of frames) expect(sniffMediaType(f.jpeg)?.mime).toBe('image/jpeg');
    expect(frames[0]!.atSeconds).toBeLessThan(frames.at(-1)!.atSeconds);
  });

  it('extracts mono 16 kHz audio for transcription', async () => {
    const wav = await extractAudioForTranscription(video, dir);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
  });
});

describe('imageForVision', () => {
  it('downscales a large image to a JPEG no wider than the limit', async () => {
    const jpeg = await imageForVision(readFileSync(png), dir, 1024);
    expect(sniffMediaType(jpeg)?.mime).toBe('image/jpeg');
    const probe = await probeMedia(join(dir, 'check.jpg'), jpeg);
    expect(probe.width).toBeLessThanOrEqual(1024);
  });
});
