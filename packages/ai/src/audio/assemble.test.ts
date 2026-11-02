import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createToneTts } from '../tts/tone';
import type { SpeakOptions, TtsEngine } from '../tts/types';
import { assembleEpisode, levelMatch, measureDuration, pauseBefore, rms, seededRandom, suspectTake, trimSilence } from './assemble';

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
    const result = await assembleEpisode({ turns, tts, outFile: out, bitrateKbps: 64, workDir: dir, roomTone: true });
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
