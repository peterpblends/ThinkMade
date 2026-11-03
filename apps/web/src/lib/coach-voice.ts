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
  /**
   * Adds `text` after whatever is already being said, with no gap: the next sentence is prepared while the
   * one before plays. Resolves when it has been said (or `stop` was called).
   */
  say(text: string, onProgress?: (spokenSoFar: string) => void): Promise<void>;
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
/** Longest wait for the natural voice's first sound before the device voice takes over (ms). */
const FIRST_SOUND_MS = 900;

/**
 * `lang` is the conversation's language (a BCP-47 tag such as "es-MX"). The on-device Phonon voice speaks
 * English; other languages use the device's own voice for that language.
 */
export function createCoachSpeaker(lang = 'en-US'): CoachSpeaker {
  const english = lang.toLowerCase().startsWith('en');
  let phonon: Phonon | null = null;
  let loading: Promise<void> | null = null;
  // If this device can't generate speech quickly enough, the device voice takes over for good.
  let tooSlow = false;
  let ctx: AudioContext | null = null;
  let sources: AudioBufferSourceNode[] = [];
  // When the natural voice's scheduled audio ends (AudioContext time).
  let t = 0;
  // Everything queued since the last stop shares this signal; stop aborts it.
  let abort = new AbortController();
  type Item = { text: string; onProgress?: ((s: string) => void) | undefined; resolve: () => void; signal: AbortSignal };
  const queue: Item[] = [];
  let draining = false;

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
    if (ctx) t = ctx.currentTime;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  /** Waits until the natural voice's scheduled audio has played (or the signal aborts). */
  const untilPlayed = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const wait = ctx ? Math.max(0, (t - ctx.currentTime) * 1000) : 0;
      if (!wait || signal.aborted) return resolve();
      const timer = setTimeout(resolve, wait);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });

  const speakDevice = async (item: Item) => {
    // Never talk over natural-voice audio that is still playing.
    await untilPlayed(item.signal);
    await new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window) || item.signal.aborted) return resolve();
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = lang;
      const v = deviceVoice(lang);
      if (v) u.voice = v;
      u.rate = 1.05;
      u.onboundary = (e) => item.onProgress?.(item.text.slice(0, e.charIndex));
      u.onend = () => resolve();
      u.onerror = () => resolve();
      item.signal.addEventListener('abort', () => resolve(), { once: true });
      window.speechSynthesis.speak(u);
    });
    item.onProgress?.(item.text);
    item.resolve();
  };

  /** Synthesises the item and schedules it after what is already playing; resolves it when it will have played. */
  const speakPhonon = async (item: Item) => {
    const tts = phonon!;
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const idle = t <= ctx.currentTime + 0.05;
    const asked = performance.now();
    let first = true;
    let late = 0;
    const stream = tts.stream(item.text, { voice: 'coach', temperature: 0.4, signal: item.signal });
    for await (const pcm of stream) {
      if (item.signal.aborted) return item.resolve();
      if (first && idle && performance.now() - asked > FIRST_SOUND_MS) tooSlow = true;
      first = false;
      const buffer = ctx.createBuffer(1, pcm.length, tts.sampleRate);
      buffer.getChannelData(0).set(pcm);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      if (t < ctx.currentTime - 0.15) late++;
      t = Math.max(t, ctx.currentTime + 0.03);
      source.start(t);
      sources.push(source);
      t += buffer.duration;
    }
    if (late > 2) tooSlow = true;
    t += 0.1; // a breath between sentences
    const ends = Math.max(0, (t - ctx.currentTime) * 1000);
    const timer = setTimeout(() => (item.onProgress?.(item.text), item.resolve()), ends);
    item.signal.addEventListener('abort', () => (clearTimeout(timer), item.resolve()), { once: true });
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const item = queue.shift()!;
      if (item.signal.aborted) {
        item.resolve();
        continue;
      }
      if (phonon && !tooSlow) {
        // The natural voice runs ahead: the next sentence is prepared while this one plays.
        await speakPhonon(item).catch(() => (item.signal.aborted ? item.resolve() : ((tooSlow = true), speakDevice(item))));
      } else {
        await speakDevice(item);
      }
    }
    draining = false;
  };

  const say = (text: string, onProgress?: (s: string) => void) =>
    new Promise<void>((resolve) => {
      queue.push({ text, onProgress, resolve, signal: abort.signal });
      void drain();
    });

  const stop = () => {
    abort.abort();
    abort = new AbortController();
    for (const item of queue.splice(0)) item.resolve();
    stopSound();
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
    say,
    speak(text, onProgress) {
      stop();
      return say(text, onProgress);
    },
    stop,
  };
}
