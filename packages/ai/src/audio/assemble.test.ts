import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createToneTts } from '../tts/tone';
import { assembleEpisode, measureDuration } from './assemble';

const dir = mkdtempSync(join(tmpdir(), 'tm-audio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('assembleEpisode', () => {
  it('produces a real MP3 whose measured length matches the speech plus pauses', async () => {
    const tts = createToneTts();
    const turns = [
      { voice: 'af_heart', text: 'Welcome to ThinkMade. Today we explore opportunity cost.' },
      { voice: 'am_michael', text: 'Every choice has a hidden price: the best alternative you give up.' },
      { voice: 'af_heart', text: 'Let us see where that shows up at work.' },
    ];
    const out = join(dir, 'ep.mp3');
    const result = await assembleEpisode({ turns, tts, outFile: out, pauseMs: 350, bitrateKbps: 64, workDir: dir });
    const expected = result.speechSeconds + (0.35 * (turns.length - 1));
    expect(statSync(out).size).toBeGreaterThan(1000);
    expect(result.durationSeconds).toBeGreaterThan(expected - 0.3);
    expect(result.durationSeconds).toBeLessThan(expected + 0.6);
    expect(await measureDuration(out)).toBeCloseTo(result.durationSeconds, 1);
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
});
