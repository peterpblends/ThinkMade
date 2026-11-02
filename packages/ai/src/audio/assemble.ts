import { createWriteStream, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { toSpeechText } from '../text/speech-text';
import { countWords, splitForSpeech } from '../text/split';
import type { SpeakOptions, TtsEngine } from '../tts/types';
import { runFfmpeg } from './ffmpeg';

export interface SpeakerTurn {
  voice: string;
  text: string;
  /** The turn starts a new section of the episode: take a longer breath before it. */
  sectionBreak?: boolean;
}

export type Pacing = 'relaxed' | 'natural' | 'brisk';
export type Expressiveness = 'steady' | 'natural' | 'expressive';

export interface AssembleOptions {
  turns: SpeakerTurn[];
  tts: TtsEngine;
  outFile: string;
  workDir: string;
  /** Overall pause length between lines and speakers. */
  pacing?: Pacing;
  /** How much the voices vary their delivery. */
  expressiveness?: Expressiveness;
  /** A very quiet room tone under the whole episode, so pauses don't sound like dead air. */
  roomTone?: boolean;
  /**
   * Natural delivery: each sentence at a slightly different pace, as people speak, and a gentle mastering chain
   * (warmth, softer synthetic sibilance, light compression and a faint room) instead of a dry, clinical sound.
   */
  natural?: boolean;
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
  /** Automatic audio checks: takes redone, and lines still suspect after a retry. */
  checks: { chunks: number; retried: number; suspect: string[] };
}

const PACE: Record<Pacing, number> = { relaxed: 1.25, natural: 1, brisk: 0.8 };
const SPEED: Record<Pacing, number> = { relaxed: 0.96, natural: 1, brisk: 1.05 };
const EXPRESSION: Record<Expressiveness, number> = { steady: 0.15, natural: 0.4, expressive: 0.75 };
/** Speech level each line is brought to before the final loudness pass, so every voice sounds equally close. */
const TARGET_RMS = 0.08;
/** Room tone level: about -63 dBFS. */
const ROOM_TONE_LEVEL = 0.0007;
/** The final processing: plain clean-up and loudness, or the natural-delivery mastering chain. */
export const MASTERING = {
  plain: 'highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=11',
  natural: [
    'highpass=f=70',
    'equalizer=f=200:t=q:w=1.2:g=1.5', // body and warmth
    'equalizer=f=3500:t=q:w=1.5:g=1', // presence
    'equalizer=f=7500:t=q:w=2:g=-2', // the "synthetic" fizz some voices have
    'acompressor=threshold=-21dB:ratio=2.2:attack=12:release=180',
    'aecho=0.85:0.9:14|27:0.06|0.035', // a few early reflections: a small, quiet room
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(','),
} as const;

/** A small deterministic random source, so the same script always produces the same audio. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Removes the silence an engine leaves around a line (it varies from line to line, which is what makes
 * joined clips sound disconnected), keeping a few milliseconds so consonants aren't clipped, with short fades.
 */
export function trimSilence(samples: Float32Array, rate: number, threshold = 0.012): Float32Array {
  const win = Math.max(1, Math.round(rate * 0.01));
  const loud = (i: number) => {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) peak = Math.max(peak, Math.abs(samples[j]!));
    return peak >= threshold;
  };
  let start = 0;
  while (start < samples.length && !loud(start)) start += win;
  let end = samples.length;
  while (end > start && !loud(Math.max(start, end - win))) end -= win;
  if (end <= start) return new Float32Array(0);
  const margin = Math.round(rate * 0.025);
  const out = samples.slice(Math.max(0, start - margin), Math.min(samples.length, end + margin));
  const fade = Math.min(Math.round(rate * 0.008), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i]! *= g;
    out[out.length - 1 - i]! *= g;
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Brings a line to the shared speech level, within limits, with a gentle ceiling so peaks never clip. */
export function levelMatch(samples: Float32Array): Float32Array {
  const level = rms(samples);
  if (level < 1e-4) return samples;
  const gain = Math.min(4, Math.max(0.4, TARGET_RMS / level));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.tanh(samples[i]! * gain * 1.1) / 1.1;
  return out;
}

/**
 * Whether a take sounds wrong for its text: silent, far too short (cut off) or far too long (the engine
 * rambled or repeated itself). Ordinary speech runs about 0.25 to 0.6 seconds a word.
 */
export function suspectTake(seconds: number, level: number, words: number): string | null {
  if (level < 0.004) return 'silent';
  if (words >= 3 && seconds < words * 0.12) return 'cut off';
  if (seconds > words * 0.9 + 1.5) return 'too long';
  return null;
}

/**
 * The pause before a line, in milliseconds, the way people talk: a quick reply after a short reaction, a beat
 * after a question, a longer breath at a new section, a short gap inside one speaker's turn. Varies slightly.
 */
export function pauseBefore(
  prev: { text: string; sameSpeaker: boolean; midSentence: boolean },
  next: { words: number; sectionBreak: boolean },
  random: () => number,
): number {
  let ms: number;
  if (next.sectionBreak) ms = 900;
  else if (prev.sameSpeaker) ms = prev.midSentence ? 90 : /\?\s*$/.test(prev.text) ? 300 : 220;
  else if (next.words <= 5) ms = 170;
  else if (/\?\s*$/.test(prev.text)) ms = 420;
  else if (countWords(prev.text) <= 5) ms = 210;
  else ms = 300;
  return ms * (0.88 + random() * 0.24);
}

/**
 * Speaks each turn line by line and joins the lines, with natural pauses, into one continuous recording; then
 * normalises loudness and encodes MP3. The returned duration is measured from the MP3.
 */
export async function assembleEpisode(opts: AssembleOptions): Promise<AssembleResult> {
  const rate = opts.tts.sampleRate;
  const pacing = opts.pacing ?? 'natural';
  const expressiveness = EXPRESSION[opts.expressiveness ?? 'natural'];
  const raw = join(opts.workDir, `pcm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.raw`);
  const out = createWriteStream(raw);
  const random = seededRandom(hashString(opts.turns.map((t) => t.text).join('|').slice(0, 2000)));
  // Room tone: quiet, slightly low-passed noise under everything, so a pause sounds like the same room.
  let noise = 0;
  const tone = () => {
    if (!opts.roomTone) return 0;
    noise = 0.97 * noise + 0.03 * (random() * 2 - 1);
    return noise * ROOM_TONE_LEVEL * 6;
  };
  const write = async (samples: Float32Array) => {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]! + tone()));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    if (!out.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))) await once(out, 'drain');
  };
  const silence = (ms: number) => new Float32Array(Math.round((ms / 1000) * rate * PACE[pacing]));

  const checks: AssembleResult['checks'] = { chunks: 0, retried: 0, suspect: [] };
  const speak = async (text: string, voice: string): Promise<Float32Array> => {
    const words = countWords(text);
    // People don't speak every sentence at one pace: with natural delivery, each varies by up to ±3%.
    const drift = opts.natural ? 1 + (random() - 0.5) * 0.06 : 1;
    const base: SpeakOptions = { speed: SPEED[pacing] * (words <= 4 ? 1.04 : 1) * drift, expressiveness };
    let best: { samples: Float32Array; problem: string | null } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      opts.signal?.throwIfAborted();
      const audio = await opts.tts.synthesize(text, voice, { ...base, variation: hashString(`${voice}|${text}|${attempt}`) });
      if (audio.sampleRate !== rate) throw new Error(`TTS returned ${audio.sampleRate} Hz, expected ${rate} Hz`);
      const trimmed = trimSilence(audio.samples, rate);
      const problem = suspectTake(trimmed.length / rate, rms(trimmed), words);
      if (!best || (best.problem && !problem)) best = { samples: trimmed, problem };
      if (!problem) break;
      if (attempt === 0) checks.retried++;
    }
    checks.chunks++;
    if (best!.problem) checks.suspect.push(`${best!.problem}: "${text.slice(0, 60)}"`);
    return levelMatch(best!.samples);
  };

  let speechSamples = 0;
  try {
    let prev: { text: string; turn: number; midSentence: boolean } | null = null;
    for (let t = 0; t < opts.turns.length; t++) {
      const turn = opts.turns[t]!;
      const chunks = splitForSpeech(toSpeechText(turn.text));
      for (let c = 0; c < chunks.length; c++) {
        const text = chunks[c]!;
        if (prev) {
          const gap = pauseBefore(
            { text: prev.text, sameSpeaker: prev.turn === t, midSentence: prev.midSentence },
            { words: countWords(text), sectionBreak: c === 0 && !!turn.sectionBreak },
            random,
          );
          await write(silence(gap));
        }
        const samples = await speak(text, turn.voice);
        speechSamples += samples.length;
        await write(samples);
        prev = { text, turn: t, midSentence: !/[.!?]["')\]]*\s*$/.test(text) };
      }
      await opts.onProgress?.(t + 1, opts.turns.length);
    }
    // A moment of room tone at the end so the episode doesn't stop abruptly.
    await write(silence(400));
    out.end();
    await once(out, 'finish');
    opts.signal?.throwIfAborted();
    await runFfmpeg([
      '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw,
      '-af', opts.natural ? MASTERING.natural : MASTERING.plain,
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
    checks,
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
