import type { SpeechRequest, SpeechResponse } from './speech.worker';

/** Moonshine expects 16 kHz mono. */
export const SPEECH_SAMPLE_RATE = 16_000;

export type OnDeviceStatus = { phase: 'idle' | 'loading' | 'ready' | 'failed'; fraction: number };

export interface OnDeviceSpeech {
  /** True once the model has loaded on this device. */
  readonly ready: boolean;
  readonly status: OnDeviceStatus;
  /** Starts the one-time model download and load, if it hasn't started. */
  prepare(): void;
  transcribe(audio: Float32Array): Promise<string>;
  /** Calls `fn` on every status change; returns an unsubscribe function. */
  subscribe(fn: (s: OnDeviceStatus) => void): () => void;
}

const PREF_KEY = 'thinkmade.onDeviceSpeech';

/** The listener's choice to transcribe on this device. Off by default, because it downloads about 90 MB. */
export function onDeviceSpeechEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setOnDeviceSpeechEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/**
 * Whether this device should try on-device recognition: WebAssembly SIMD and workers, a secure
 * context, and not a data-saver connection or a device reporting under 2 GB of memory.
 */
export function canRecogniseOnDevice(): boolean {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || !window.isSecureContext) return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData || (nav.deviceMemory !== undefined && nav.deviceMemory < 2)) return false;
  try {
    // A minimal module using SIMD instructions (the wasm-feature-detect test); validates only where SIMD exists.
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

let shared: OnDeviceSpeech | null = null;

/** One recogniser per page, created on first use. */
export function onDeviceSpeech(): OnDeviceSpeech {
  if (shared) return shared;
  const worker = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(s: OnDeviceStatus) => void>();
  let nextId = 1;
  let status: OnDeviceStatus = { phase: 'idle', fraction: 0 };
  const setStatus = (s: OnDeviceStatus) => {
    status = s;
    for (const fn of listeners) fn(s);
  };
  worker.onmessage = ({ data }: MessageEvent<SpeechResponse>) => {
    if (data.type === 'ready') setStatus({ phase: 'ready', fraction: 1 });
    else if (data.type === 'progress' && data.total) setStatus({ phase: 'loading', fraction: data.loaded / data.total });
    else if (data.type === 'result') pending.get(data.id)?.resolve(data.text);
    else if (data.type === 'error') {
      if (data.id !== undefined) pending.get(data.id)?.reject(new Error(data.message));
      else setStatus({ phase: 'failed', fraction: 0 }); // a later prepare() retries
    }
    if ((data.type === 'result' || data.type === 'error') && data.id !== undefined) pending.delete(data.id);
  };
  const send = (m: SpeechRequest, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  shared = {
    get ready() {
      return status.phase === 'ready';
    },
    get status() {
      return status;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    prepare() {
      if (status.phase === 'loading' || status.phase === 'ready') return;
      setStatus({ phase: 'loading', fraction: 0 });
      send({ type: 'load' });
    },
    transcribe(audio) {
      const id = nextId++;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'transcribe', id, audio }, [audio.buffer]);
      });
    },
  };
  return shared;
}

/** Decodes a recording (WebM/Opus, MP4/AAC...) to 16 kHz mono samples. */
export async function decodeForSpeech(blob: Blob): Promise<Float32Array> {
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const decoded = await new Ctx(1, 1, SPEECH_SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer());
  // Render through an offline context to resample and mix down to mono.
  const offline = new Ctx(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE), SPEECH_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0);
}
