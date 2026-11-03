import { describe, expect, it } from 'vitest';
import { downsample, encodeWav } from './turn-audio';

describe('turn recordings', () => {
  it('are 16-bit mono WAV files', async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16_000);
    expect(wav.type).toBe('audio/wav');
    const view = new DataView(await wav.arrayBuffer());
    const tag = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
    expect([tag(0), tag(8), tag(36)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
  });

  it('are brought down to 16 kHz, averaging as they go', () => {
    const out = downsample(new Float32Array([1, 1, 1, 0, 0, 0]), 48_000, 16_000);
    expect(Array.from(out)).toEqual([1, 0]);
    const same = new Float32Array([0.1, 0.2]);
    expect(downsample(same, 16_000, 16_000)).toBe(same);
  });
});
