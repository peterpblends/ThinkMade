import type { TtsEngine } from './types';

/**
 * Test engine: produces quiet real audio whose length follows speaking rate (about 150 words a minute),
 * with pitch varying by voice so two hosts are distinguishable. Never used in production.
 */
export function createToneTts(sampleRate = 24_000): TtsEngine {
  return {
    name: 'tone',
    sampleRate,
    async synthesize(text, voice) {
      const words = Math.max(1, text.trim().split(/\s+/).length);
      const seconds = words * 0.4;
      const n = Math.round(seconds * sampleRate);
      const freq = 180 + ([...voice].reduce((a, c) => a + c.charCodeAt(0), 0) % 120);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = 0.1 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      return { samples, sampleRate };
    },
  };
}
