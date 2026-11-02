/**
 * The coach's speaking voice in a spoken conversation. Phonon (Apache-2.0) runs on this device, from model files
 * the app serves itself (/speech/phonon, prepared by scripts/prepare-speech.ts), and streams speech as it is
 * generated. Until it has loaded, or where it can't keep up, the device's own voice speaks instead.
 */

/** Paths of the self-hosted Phonon model and the coach's voice (Hadley). */
const PHONON = '/speech/phonon';
const MODEL = {
  weights: { q8: `${PHONON}/model.q8.gguf` },
  tokenizer: `${PHONON}/tokenizer.json`,
  config: `${PHONON}/config.json`,
  voices: { coach: `${PHONON}/coach-voice.safetensors` },
  defaultVoice: 'coach',
};

export type VoiceEngine = 'phonon' | 'device';

export interface CoachSpeaker {
  /** Which voice speaks next. */
  readonly engine: VoiceEngine;
  /** Call from a tap: unlocks audio and starts loading the natural voice in the background. */
  prepare(): void;
  /** Speaks `text`; resolves when it has been said or `stop` was called. `onProgress` reports what has been said so far. */
  speak(text: string, onProgress?: (spokenSoFar: string) => void): Promise<void>;
  /** Stops speaking at once. */
  stop(): void;
}

type Phonon = {
  stream: (text: string, o: { voice?: string; temperature?: number; signal?: AbortSignal }) => AsyncIterable<Float32Array> & { cancel(): void; done: Promise<unknown> };
  sampleRate: number;
};

function canRunPhonon(): boolean {
  if (typeof window === 'undefined' || typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  return nav.deviceMemory === undefined || nav.deviceMemory >= 2;
}

/** The most natural-sounding voice the device offers for `lang` (e.g. "es-MX"): its "enhanced" or "natural" voices first. */
function deviceVoice(lang: string): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const base = lang.split('-')[0]!.toLowerCase();
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base);
  const rank = (v: SpeechSynthesisVoice) =>
    (/natural|neural|premium|enhanced/i.test(v.name) ? 4 : 0) +
    (v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase() ? 2 : 0) +
    (/google|samantha|ava|allison|aria|jenny/i.test(v.name) ? 1 : 0) +
    (v.localService ? 0.5 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** Splits a reply into sentences, so speech can start before the whole reply is synthesised. */
export function sentences(text: string): string[] {
  return (text.replace(/\s+/g, ' ').match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * `lang` is the conversation's language (a BCP-47 tag such as "es-MX"). The on-device Phonon voice speaks
 * English; other languages use the device's own voice for that language.
 */
export function createCoachSpeaker(lang = 'en-US'): CoachSpeaker {
  const english = lang.toLowerCase().startsWith('en');
  let phonon: Phonon | null = null;
  let loading: Promise<void> | null = null;
  // If this device can't generate speech faster than it plays, the device voice takes over.
  let tooSlow = false;
  let ctx: AudioContext | null = null;
  let sources: AudioBufferSourceNode[] = [];
  let abort: AbortController | null = null;
  let finish: (() => void) | null = null;

  const loadPhonon = () =>
    (loading ??= (async () => {
      if (!english || !canRunPhonon()) return;
      // The model files are only there when the build prepared them.
      const head = await fetch(MODEL.config, { method: 'HEAD' }).catch(() => null);
      if (!head?.ok) return;
      const { PhononTTS } = await import('phonon-tts');
      phonon = (await PhononTTS.load({ lang: 'en', model: MODEL, device: 'auto' })) as unknown as Phonon;
    })().catch(() => {
      phonon = null;
    }));

  const stopSound = () => {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sources = [];
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const speakDevice = (text: string, signal: AbortSignal, onProgress?: (s: string) => void) =>
    new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window) || signal.aborted) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = deviceVoice(lang);
      if (v) u.voice = v;
      u.rate = 1.03;
      u.onboundary = (e) => onProgress?.(text.slice(0, e.charIndex));
      u.onend = () => resolve();
      u.onerror = () => resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
      window.speechSynthesis.speak(u);
    });

  const speakPhonon = async (text: string, signal: AbortSignal, onProgress?: (s: string) => void) => {
    const tts = phonon!;
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const parts = sentences(text);
    let t = ctx.currentTime + 0.05;
    let late = 0;
    let said = '';
    for (const part of parts) {
      if (signal.aborted) return;
      const stream = tts.stream(part, { voice: 'coach', temperature: 0.4, signal });
      for await (const pcm of stream) {
        if (signal.aborted) return;
        const buffer = ctx.createBuffer(1, pcm.length, tts.sampleRate);
        buffer.getChannelData(0).set(pcm);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        if (t < ctx.currentTime - 0.15) late++;
        t = Math.max(t, ctx.currentTime);
        source.start(t);
        sources.push(source);
        t += buffer.duration;
      }
      said = `${said} ${part}`.trim();
      const at = said;
      setTimeout(() => onProgress?.(at), Math.max(0, (t - ctx.currentTime) * 1000));
      t += 0.12; // a breath between sentences
    }
    if (late > 2) tooSlow = true;
    // Wait for the scheduled audio to finish playing (or for stop).
    await new Promise<void>((resolve) => {
      const wait = Math.max(0, (t - ctx!.currentTime) * 1000);
      const timer = setTimeout(resolve, wait);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });
  };

  return {
    get engine() {
      return phonon && !tooSlow ? 'phonon' : 'device';
    },
    prepare() {
      // Audio may only start from a tap: create (and unlock) the audio context and the device voice now.
      if (typeof window === 'undefined') return;
      try {
        ctx ??= new AudioContext();
        void ctx.resume();
      } catch {
        ctx = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
      void loadPhonon();
    },
    async speak(text, onProgress) {
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      const done = new Promise<void>((resolve) => (finish = resolve));
      const run = (phonon && !tooSlow ? speakPhonon(text, controller.signal, onProgress) : speakDevice(text, controller.signal, onProgress)).catch(() =>
        // The natural voice failed mid-reply: say it with the device voice instead.
        controller.signal.aborted ? undefined : ((tooSlow = true), speakDevice(text, controller.signal, onProgress)),
      );
      await Promise.race([run, done]);
      if (abort === controller) abort = null;
    },
    stop() {
      abort?.abort();
      abort = null;
      stopSound();
      finish?.();
    },
  };
}
