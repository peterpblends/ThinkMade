import { createWriteStream, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { splitForSpeech } from '../text/split';
import type { TtsEngine } from '../tts/types';
import { runFfmpeg } from './ffmpeg';

export interface SpeakerTurn {
  voice: string;
  text: string;
}

export interface AssembleOptions {
  turns: SpeakerTurn[];
  tts: TtsEngine;
  outFile: string;
  workDir: string;
  pauseMs?: number;
  bitrateKbps?: number;
  /** Stops between speech chunks (for example when the listener cancels). */
  signal?: AbortSignal;
  /** Called after each turn is synthesised with (turnsDone, totalTurns). */
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

export interface AssembleResult {
  durationSeconds: number;
  speechSeconds: number;
  bytes: number;
}

function toInt16(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return buf;
}

/**
 * Synthesises each turn (split into speakable chunks), streams raw PCM to disk with a pause between
 * turns, then normalises loudness and encodes MP3. The returned duration is measured from the MP3.
 */
export async function assembleEpisode(opts: AssembleOptions): Promise<AssembleResult> {
  const rate = opts.tts.sampleRate;
  const raw = join(opts.workDir, `pcm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.raw`);
  const out = createWriteStream(raw);
  const write = async (buf: Buffer) => {
    if (!out.write(buf)) await once(out, 'drain');
  };
  const pause = Buffer.alloc(Math.round(((opts.pauseMs ?? 350) / 1000) * rate) * 2);
  const shortPause = Buffer.alloc(Math.round(0.12 * rate) * 2);
  let speechSamples = 0;
  try {
    for (let t = 0; t < opts.turns.length; t++) {
      const turn = opts.turns[t]!;
      const chunks = splitForSpeech(turn.text);
      for (let c = 0; c < chunks.length; c++) {
        opts.signal?.throwIfAborted();
        const audio = await opts.tts.synthesize(chunks[c]!, turn.voice);
        if (audio.sampleRate !== rate) throw new Error(`TTS returned ${audio.sampleRate} Hz, expected ${rate} Hz`);
        speechSamples += audio.samples.length;
        await write(toInt16(audio.samples));
        if (c < chunks.length - 1) await write(shortPause);
      }
      if (t < opts.turns.length - 1) await write(pause);
      await opts.onProgress?.(t + 1, opts.turns.length);
    }
    out.end();
    await once(out, 'finish');
    opts.signal?.throwIfAborted();
    await runFfmpeg([
      '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', `${opts.bitrateKbps ?? 64}k`,
      opts.outFile,
    ]);
  } finally {
    out.destroy();
    rmSync(raw, { force: true });
  }
  const { statSync } = await import('node:fs');
  return {
    durationSeconds: await measureDuration(opts.outFile),
    speechSeconds: speechSamples / rate,
    bytes: statSync(opts.outFile).size,
  };
}

/** Decodes the whole file and reports its real playing time in seconds. */
export async function measureDuration(file: string): Promise<number> {
  const log = await runFfmpeg(['-i', file, '-f', 'null', '-']);
  const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.at(-1);
  if (!last) throw new Error('Could not measure audio duration');
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}
