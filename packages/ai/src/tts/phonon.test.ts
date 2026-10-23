import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPhononTts, createVoiceRouterTts, kokoroFallbackVoice } from './phonon';
import type { TtsEngine } from './types';

const engine = (name: string, fail = false): TtsEngine & { calls: string[] } => {
  const calls: string[] = [];
  return {
    name,
    sampleRate: 24_000,
    calls,
    async synthesize(_text, voice) {
      calls.push(voice);
      if (fail) throw new Error('boom');
      return { samples: new Float32Array(10), sampleRate: 24_000 };
    },
  };
};

describe('voice router', () => {
  it('sends Phonon voices to Phonon and Kokoro voices to Kokoro', async () => {
    const phonon = engine('phonon');
    const kokoro = engine('kokoro');
    const tts = createVoiceRouterTts({ phonon, kokoro });
    await tts.synthesize('hi', 'phonon:zoey');
    await tts.synthesize('hi', 'am_adam');
    expect(phonon.calls).toEqual(['phonon:zoey']);
    expect(kokoro.calls).toEqual(['am_adam']);
  });

  it('falls back to the closest Kokoro voice when Phonon fails, and stops retrying it', async () => {
    const phonon = engine('phonon', true);
    const kokoro = engine('kokoro');
    const logs: string[] = [];
    const tts = createVoiceRouterTts({ phonon, kokoro }, (m) => logs.push(m));
    await tts.synthesize('hi', 'phonon:easton');
    await tts.synthesize('hi', 'phonon:maeve');
    expect(kokoro.calls).toEqual(['am_michael', 'bf_emma']);
    expect(phonon.calls).toHaveLength(1);
    expect(logs[0]).toMatch(/Phonon failed/);
  });

  it('maps by accent and gender', () => {
    expect(kokoroFallbackVoice('phonon:zoey')).toBe('af_heart');
    expect(kokoroFallbackVoice('phonon:hugh')).toBe('bm_george');
    expect(kokoroFallbackVoice('af_bella')).toBe('af_bella');
  });
});

describe('Phonon engine', () => {
  it('rejects unknown voices clearly', async () => {
    const tts = createPhononTts({ cacheDir: mkdtempSync(join(tmpdir(), 'phonon-')), fetch: (async () => new Response('no', { status: 404 })) as unknown as typeof fetch });
    await expect(tts.synthesize('hi', 'phonon:nobody')).rejects.toThrow(/download|Unknown Phonon voice/);
  });

  // Downloads ~65 MB; run with PHONON_LIVE=1.
  it.runIf(process.env.PHONON_LIVE === '1')('speaks with two distinct voices', { timeout: 300_000 }, async () => {
    const tts = createPhononTts({ cacheDir: process.env.PHONON_CACHE ?? join('.data', 'models', 'phonon') });
    const a = await tts.synthesize('Second-order thinking asks: and then what?', 'phonon:zoey');
    const b = await tts.synthesize('Second-order thinking asks: and then what?', 'phonon:easton');
    expect(a.sampleRate).toBe(24_000);
    expect(a.samples.length / 24_000).toBeGreaterThan(1.5);
    expect(b.samples).not.toEqual(a.samples);
  });
});
