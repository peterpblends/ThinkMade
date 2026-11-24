import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createToneTts } from '../tts/tone';
import type { SpeakOptions, TtsEngine } from '../tts/types';
import { runFfmpeg } from './ffmpeg';
import { assembleEpisode, levelMatch, MAX_TAKE_CHARS, measureDuration, pauseBefore, rms, seededRandom, suspectTake, trimSilence } from './assemble';

const dir = mkdtempSync(join(tmpdir(), 'tm-audio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const RATE = 24_000;
const tone = (seconds: number, amp = 0.1) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE));
const padded = (s: Float32Array, before: number, after: number) => {
  const out = new Float32Array(Math.round((before + after) * RATE) + s.length);
  out.set(s, Math.round(before * RATE));
  return out;
};

describe('assembleEpisode', () => {
  it('produces a real MP3 of the speech joined by natural pauses', async () => {
    const tts = createToneTts();
    const turns = [
      { voice: 'af_heart', text: 'Here is a strange thing about opportunity cost.' },
      { voice: 'am_michael', text: 'Wait, why strange?' },
      { voice: 'af_heart', text: 'Because the price you pay is invisible.', sectionBreak: true },
    ];
    const out = join(dir, 'ep.mp3');
    const result = await assembleEpisode({ turns, tts, outFile: out, bitrateKbps: 64, workDir: dir });
    expect(statSync(out).size).toBeGreaterThan(1000);
    // Two pauses (a quick reply, then a section break) and a short tail.
    expect(result.durationSeconds).toBeGreaterThan(result.speechSeconds + 0.15 + 0.75 + 0.3);
    expect(result.durationSeconds).toBeLessThan(result.speechSeconds + 0.6 + 1.2 + 0.6);
    expect(await measureDuration(out)).toBeCloseTo(result.durationSeconds, 1);
    expect(result.checks).toEqual({ chunks: 3, retried: 0, suspect: [] });
  }, 60_000);

  it('with natural delivery, varies the pace of each sentence and masters through the natural chain', async () => {
    const speeds: number[] = [];
    const tone = createToneTts();
    const tts = { ...tone, synthesize: (text: string, voice: string, o?: { speed?: number }) => (speeds.push(o?.speed ?? 1), tone.synthesize(text, voice, o)) };
    const turns = [
      { voice: 'af_heart', text: 'Here is a strange thing. It hides in plain sight. Most people never notice it at all.' },
      { voice: 'am_michael', text: 'So what is it, then? Tell me more about the thing.' },
    ];
    const out = join(dir, 'natural.mp3');
    const result = await assembleEpisode({ turns, tts, outFile: out, workDir: dir, natural: true });
    expect(statSync(out).size).toBeGreaterThan(1000);
    expect(await measureDuration(out)).toBeCloseTo(result.durationSeconds, 1);
    expect(new Set(speeds.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
    for (const x of speeds) expect(Math.abs(x - 1)).toBeLessThanOrEqual(0.03 + 0.04 * 1.03 + 1e-9);
    // Without natural delivery every full sentence is read at the same pace.
    speeds.length = 0;
    await assembleEpisode({ turns: [turns[0]!], tts, outFile: join(dir, 'plain.mp3'), workDir: dir });
    expect(new Set(speeds).size).toBe(1);
  }, 60_000);

  it('reports progress per turn', async () => {
    const seen: number[] = [];
    await assembleEpisode({
      turns: [{ voice: 'a', text: 'One.' }, { voice: 'a', text: 'Two.' }],
      tts: createToneTts(),
      outFile: join(dir, 'p.mp3'),
      workDir: dir,
      onProgress: (done) => {
        seen.push(done);
      },
    });
    expect(seen).toEqual([1, 2]);
  }, 60_000);

  it('redoes a take that came back silent, and gives every line its own delivery', async () => {
    const calls: SpeakOptions[] = [];
    let first = true;
    const flaky: TtsEngine = {
      name: 'flaky',
      sampleRate: RATE,
      async synthesize(text, _voice, opts) {
        calls.push(opts ?? {});
        if (first) {
          first = false;
          return { samples: new Float32Array(RATE), sampleRate: RATE };
        }
        return { samples: tone(text.split(' ').length * 0.35), sampleRate: RATE };
      },
    };
    const result = await assembleEpisode({
      turns: [{ voice: 'a', text: 'This first line comes back silent once.' }, { voice: 'b', text: 'And this one is fine.' }],
      tts: flaky,
      outFile: join(dir, 'r.mp3'),
      workDir: dir,
      expressiveness: 'expressive',
    });
    expect(result.checks).toEqual({ chunks: 2, retried: 1, suspect: [] });
    expect(new Set(calls.map((c) => c.variation)).size).toBe(3);
    expect(calls.every((c) => c.expressiveness === 0.75)).toBe(true);
  }, 60_000);
});

describe('joining lines', () => {
  it("trims the engine's own silence around a line, keeping a little and fading the edges", () => {
    const trimmed = trimSilence(padded(tone(1), 0.6, 0.8), RATE);
    expect(trimmed.length / RATE).toBeGreaterThan(1);
    expect(trimmed.length / RATE).toBeLessThan(1.1);
    expect(Math.abs(trimmed[0]!)).toBeLessThan(0.001);
  });

  it('brings quiet and loud voices to the same level without clipping', () => {
    // Speech engines' voices typically sit between these levels.
    const quiet = levelMatch(tone(1, 0.04));
    const loud = levelMatch(tone(1, 0.25));
    expect(rms(quiet) / rms(loud)).toBeGreaterThan(0.85);
    expect(rms(quiet) / rms(loud)).toBeLessThan(1.15);
    expect(Math.max(...loud.map(Math.abs))).toBeLessThan(1);
  });

  it('levels a line with a clean gain: the waveform keeps its shape, with headroom', () => {
    const quiet = tone(1, 0.04);
    const out = levelMatch(quiet);
    const ratio = out[100]! / quiet[100]!;
    // Every sample scaled alike: no saturation adding fuzz.
    for (let i = 1; i < quiet.length; i += 97) if (Math.abs(quiet[i]!) > 0.01) expect(out[i]! / quiet[i]!).toBeCloseTo(ratio, 6);
    // A line already peaking near full scale isn't pushed into clipping.
    const hot = levelMatch(Float32Array.from({ length: RATE }, (_, i) => (i % 400 === 0 ? 0.98 : 0.02 * Math.sin(i / 7))));
    expect(Math.max(...hot.map(Math.abs))).toBeLessThanOrEqual(0.89 + 1e-6);
  });

  it('keeps the pauses silent: no hiss or room noise between lines, in either mastering', async () => {
    const tts = createToneTts();
    const turns = [
      { voice: 'af_heart', text: 'Here is a strange thing about opportunity cost.' },
      { voice: 'af_bella', text: 'Wait, why strange?', sectionBreak: true },
    ];
    for (const natural of [false, true]) {
      const out = join(dir, `quiet-${natural}.mp3`);
      await assembleEpisode({ turns, tts, outFile: out, workDir: dir, natural });
      await runFfmpeg(['-y', '-i', out, '-f', 'f32le', '-ac', '1', '-ar', '24000', `${out}.f32`]);
      const b = readFileSync(`${out}.f32`);
      const s = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      // The quietest 20 ms stretches are the pauses: well below -70 dBFS.
      const frames: number[] = [];
      for (let i = 0; i + 480 <= s.length; i += 480) frames.push(rms(s.subarray(i, i + 480)));
      frames.sort((a, b2) => a - b2);
      expect(20 * Math.log10(frames[Math.floor(frames.length * 0.05)]! + 1e-12)).toBeLessThan(-70);
    }
  }, 60_000);

  it('flags takes that are silent, cut off or rambling', () => {
    expect(suspectTake(3, 0.08, 8)).toBeNull();
    expect(suspectTake(3, 0.001, 8)).toBe('silent');
    expect(suspectTake(0.5, 0.08, 8)).toBe('cut off');
    expect(suspectTake(20, 0.08, 8)).toBe('too long');
  });

  it('pauses like a conversation: quick after a reaction, a beat after a question, longest at a new section', () => {
    const r = () => 0.5;
    const quick = pauseBefore({ text: 'This is a long statement about the idea.', sameSpeaker: false, midSentence: false }, { words: 2, sectionBreak: false }, r);
    const afterQuestion = pauseBefore({ text: 'So what would you do instead?', sameSpeaker: false, midSentence: false }, { words: 12, sectionBreak: false }, r);
    const section = pauseBefore({ text: 'Okay.', sameSpeaker: false, midSentence: false }, { words: 12, sectionBreak: true }, r);
    const midSentence = pauseBefore({ text: 'and then the team', sameSpeaker: true, midSentence: true }, { words: 12, sectionBreak: false }, r);
    expect(midSentence).toBeLessThan(quick);
    expect(quick).toBeLessThan(afterQuestion);
    expect(afterQuestion).toBeLessThan(section);
  });

  it('varies pauses slightly but the same script always sounds the same', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(new Set(xs).size).toBe(5);
  });
});

describe('natural voices: performed as a conversation', () => {
  it('speaks two people in takes of a minute or so, never across a section, and passes speaker names', async () => {
    const takes: Array<Array<{ speaker: string; voice: string; text: string }>> = [];
    const tone = createToneTts();
    const tts: TtsEngine = {
      name: 'fake-gemini',
      sampleRate: RATE,
      handles: (v) => v.startsWith('gemini:'),
      synthesize: () => Promise.reject(new Error('should speak as a conversation')),
      async synthesizeDialogue(lines) {
        takes.push(lines);
        return tone.synthesize(lines.map((l) => l.text).join(' '), 'af_heart');
      },
    };
    const long = 'This is a fairly long line that keeps going so that the takes have to be split eventually. '.repeat(3);
    const turns = [
      { voice: 'gemini:Sulafat', speaker: 'Sophie Lane', text: 'So here is the thing. [laughs]' },
      { voice: 'gemini:Charon', speaker: 'Charles', text: 'Go on.' },
      ...Array.from({ length: 16 }, (_, i) => ({ voice: i % 2 ? 'gemini:Charon' : 'gemini:Sulafat', speaker: i % 2 ? 'Charles' : 'Sophie Lane', text: long })),
      { voice: 'gemini:Sulafat', speaker: 'Sophie Lane', text: 'New section.', sectionBreak: true },
    ];
    const progress: number[] = [];
    const out = join(dir, 'convo.mp3');
    const result = await assembleEpisode({ turns, tts, outFile: out, workDir: dir, onProgress: (d) => void progress.push(d) });
    expect(statSync(out).size).toBeGreaterThan(1000);
    expect(takes.length).toBeGreaterThanOrEqual(3);
    for (const t of takes) expect(t.map((l) => l.text).join('').length).toBeLessThanOrEqual(MAX_TAKE_CHARS + long.length);
    // The section's first line starts a take of its own.
    expect(takes.at(-1)!.map((l) => l.text)).toEqual(['New section.']);
    // First names label the speakers; performable cues are kept.
    expect(takes[0]![0]).toEqual({ speaker: 'Sophie', voice: 'gemini:Sulafat', text: 'So here is the thing. [laughs]' });
    expect(takes[0]![1]!.speaker).toBe('Charles');
    expect(progress.at(-1)).toBe(turns.length);
    expect(result.checks.chunks).toBe(takes.length);
  }, 60_000);
});
