/**
 * Measures ThinkMade's audio with the real voices, so clean-up and casting are judged by numbers:
 *  1. noise: the background floor of each engine's raw speech, and of a short episode as it is mastered;
 *  2. voices: each castable voice's pitch, brightness and timbre, and which same-gender pairs sound alike.
 * Run from Actions → Audio probe. Writes probe/report.json and the episode MP3s.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleEpisode, runFfmpeg } from '@thinkmade/ai';
import { castableByDefault, VOICE_CATALOG } from '@thinkmade/shared';
import { createTts } from '../src/index';

const dir = process.env.PROBE_OUT ?? 'probe';
mkdirSync(dir, { recursive: true });
const tts = createTts({ ...process.env, TTS_PROVIDER: process.env.TTS_PROVIDER ?? 'phonon' } as never);
const rate = tts.sampleRate;
await tts.prepare?.();
const geminiUsable = tts.handles?.('gemini:Kore') === true;
console.log(`GEMINI_TTS ${geminiUsable ? 'usable' : 'not usable'}`);

const db = (x: number) => Math.round((x > 0 ? 20 * Math.log10(x) : -120) * 10) / 10;

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

const N = 1024;
/** Frame-by-frame level and power spectrum. */
function analyse(s: Float32Array, sr: number) {
  const frames: Array<{ rms: number; power: Float64Array }> = [];
  for (let i = 0; i + N <= s.length; i += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let e = 0;
    for (let j = 0; j < N; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (N - 1));
      re[j] = s[i + j]! * w;
      e += s[i + j]! * s[i + j]!;
    }
    fft(re, im);
    const power = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    frames.push({ rms: Math.sqrt(e / N), power });
  }
  const hz = (k: number) => (k * sr) / N;
  return { frames, hz };
}

/** Background noise: the quietest frames, and how much of their energy is hiss (above 4 kHz). */
function noise(s: Float32Array, sr: number) {
  const { frames, hz } = analyse(s, sr);
  const sorted = [...frames].sort((a, b) => a.rms - b.rms);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!.rms;
  const quiet = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.1)));
  let hi = 0;
  let all = 0;
  for (const f of quiet) {
    for (let k = 1; k < N / 2; k++) {
      if (hz(k) > 4000) hi += f.power[k]!;
      all += f.power[k]!;
    }
  }
  return { floorDb: db(q(0.05)), p20Db: db(q(0.2)), speechDb: db(q(0.8)), quietHissShare: Math.round((hi / Math.max(all, 1e-12)) * 100) / 100 };
}

/** A voice's pitch (median, Hz), brightness (spectral centroid, Hz) and timbre (16 log-spaced band levels). */
function profile(s: Float32Array, sr: number) {
  const { frames, hz } = analyse(s, sr);
  const loud = frames.filter((f) => f.rms > 0.02);
  const edges = Array.from({ length: 17 }, (_, i) => 100 * Math.pow(110, i / 16)); // 100 Hz .. 11 kHz
  const bands = new Array(16).fill(0);
  let cNum = 0;
  let cDen = 0;
  for (const f of loud) {
    for (let k = 1; k < N / 2; k++) {
      const h = hz(k);
      cNum += h * f.power[k]!;
      cDen += f.power[k]!;
      const b = edges.findIndex((e, i) => h >= e && h < edges[i + 1]!);
      if (b >= 0 && b < 16) bands[b] += f.power[k]!;
    }
  }
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  const timbre = bands.map((b) => Math.round(10 * Math.log10(b / total + 1e-9) * 10) / 10);
  // Pitch by autocorrelation on voiced frames.
  const pitches: number[] = [];
  const W = Math.round(sr * 0.04);
  for (let i = 0; i + W < s.length; i += Math.round(W / 2)) {
    let e = 0;
    for (let j = 0; j < W; j++) e += s[i + j]! * s[i + j]!;
    if (Math.sqrt(e / W) < 0.03) continue;
    let best = 0;
    let lag = 0;
    for (let l = Math.round(sr / 400); l <= Math.round(sr / 70); l++) {
      let c = 0;
      for (let j = 0; j + l < W; j++) c += s[i + j]! * s[i + j + l]!;
      if (c > best) {
        best = c;
        lag = l;
      }
    }
    if (lag && best / e > 0.5) pitches.push(sr / lag);
  }
  pitches.sort((a, b) => a - b);
  return { pitchHz: Math.round(pitches[Math.floor(pitches.length / 2)] ?? 0), brightnessHz: Math.round(cNum / Math.max(cDen, 1e-12)), timbre };
}

async function decode(file: string): Promise<Float32Array> {
  const raw = `${file}.f32`;
  await runFfmpeg(['-y', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(rate), raw]);
  const b = readFileSync(raw);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

const PROFILE_TEXT =
  "Here's the thing about deadlines. They don't just change how fast we work; they quietly change what we decide is worth doing at all. So, what would you do with one more week?";

const report: Record<string, unknown> = {};

// 1. Noise in each engine's raw speech.
const noiseVoices = (process.env.PROBE_VOICES ?? 'phonon:zoey,phonon:juniper,af_heart,af_bella').split(',');
report.rawNoise = {};
for (const v of noiseVoices) {
  const a = await tts.synthesize(PROFILE_TEXT, v, { speed: 1 });
  (report.rawNoise as Record<string, unknown>)[v] = noise(a.samples, a.sampleRate);
  console.log('raw', v, JSON.stringify((report.rawNoise as Record<string, unknown>)[v]));
}

// 2. Noise in a short mastered episode, each way it can be mastered.
const [v1, v2] = noiseVoices;
const turns = [
  { voice: v1!, text: PROFILE_TEXT },
  { voice: v2!, text: 'Wait, really? Even the small ones?' },
  { voice: v1!, text: 'Even the small ones. That is the part people miss, and it is why a week can feel like a month.' },
  { voice: v2!, text: 'Hm. I think I have felt that.' },
];
report.episodes = {};
for (const natural of [false, true]) {
  const name = `episode-${natural ? 'natural' : 'plain'}`;
  const out = join(dir, `${name}.mp3`);
  await assembleEpisode({ turns, tts, outFile: out, workDir: dir, natural });
  (report.episodes as Record<string, unknown>)[name] = noise(await decode(out), rate);
  console.log(name, JSON.stringify((report.episodes as Record<string, unknown>)[name]));
}

// 2b. A two-host conversation in Gemini's voices, performed as one conversation.
if (geminiUsable) {
  const convo = [
    { voice: 'gemini:Sulafat', speaker: 'Sophie', text: "Okay, so I have to tell you about this. In 1975, Kodak had the first digital camera. They built it. In their own lab." },
    { voice: 'gemini:Charon', speaker: 'Charles', text: 'Wait, Kodak? The film company?' },
    { voice: 'gemini:Sulafat', speaker: 'Sophie', text: "[laughs] The film company. And the reason they sat on it is the whole story of today's idea." },
    { voice: 'gemini:Charon', speaker: 'Charles', text: "Hm. Because it would have eaten their film business. Which, honestly, I get. I'd have been nervous too." },
  ];
  const out = join(dir, 'episode-gemini.mp3');
  try {
    const r = await assembleEpisode({ turns: convo, tts, outFile: out, workDir: dir, natural: true });
    console.log('episode-gemini', JSON.stringify({ seconds: r.durationSeconds, checks: r.checks, ...noise(await decode(out), rate) }));
  } catch (err) {
    console.log('episode-gemini failed', err instanceof Error ? err.message : err);
  }
}

// 3. Every castable English voice's profile.
const voices = VOICE_CATALOG.filter((v) => v.speaks.includes('en') && (castableByDefault(v) || v.heritage) && tts.handles?.(v.id) !== false);
const profiles: Record<string, ReturnType<typeof profile> & { gender: string; name: string }> = {};
for (const v of voices) {
  try {
    const a = await tts.synthesize(PROFILE_TEXT, v.id, { speed: 1 });
    profiles[v.id] = { name: v.name, gender: v.gender, ...profile(a.samples, a.sampleRate) };
    console.log('voice', v.id, v.name, v.gender, profiles[v.id]!.pitchHz, 'Hz', profiles[v.id]!.brightnessHz, 'Hz');
  } catch (err) {
    console.log('voice failed', v.id, err instanceof Error ? err.message : err);
  }
}
report.profiles = profiles;

// Same-gender pairs that sound most alike: pitch apart (semitones) and timbre apart (mean band dB).
const pairs: Array<{ a: string; b: string; semitones: number; timbreDb: number }> = [];
const ids = Object.keys(profiles);
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = profiles[ids[i]!]!;
    const b = profiles[ids[j]!]!;
    if (a.gender !== b.gender || !a.pitchHz || !b.pitchHz) continue;
    const semitones = Math.abs(12 * Math.log2(a.pitchHz / b.pitchHz));
    const timbreDb = a.timbre.reduce((n, x, k) => n + Math.abs(x - b.timbre[k]!), 0) / a.timbre.length;
    pairs.push({ a: ids[i]!, b: ids[j]!, semitones: Math.round(semitones * 10) / 10, timbreDb: Math.round(timbreDb * 10) / 10 });
  }
}
pairs.sort((x, y) => x.semitones + x.timbreDb - (y.semitones + y.timbreDb));
report.closestPairs = pairs.slice(0, 25);
console.log('closest same-gender pairs', JSON.stringify(pairs.slice(0, 25)));
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
// One line a script can pick up from the log.
console.log(`PROFILES_JSON ${JSON.stringify(Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, { pitchHz: p.pitchHz, brightnessHz: p.brightnessHz, timbre: p.timbre }])))}`);
