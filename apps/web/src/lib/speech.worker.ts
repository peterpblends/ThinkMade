/// <reference lib="webworker" />
/**
 * On-device speech recognition: Moonshine base (MIT) through Transformers.js, served by this app from
 * /speech (see scripts/prepare-speech.ts). Audio never leaves the device.
 */
import { env, pipeline } from '@huggingface/transformers';

export type SpeechRequest = { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array };
export type SpeechResponse =
  | { type: 'ready' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

const MODEL = 'onnx-community/moonshine-base-ONNX';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/speech/models/';
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = '/speech/ort/';

type Recognizer = (audio: Float32Array) => Promise<{ text: string } | Array<{ text: string }>>;
let recognizer: Promise<Recognizer> | null = null;

const post = (m: SpeechResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function load() {
  const files = new Map<string, { loaded: number; total: number }>();
  recognizer ??= pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      const all = [...files.values()];
      post({ type: 'progress', loaded: all.reduce((a, f) => a + f.loaded, 0), total: all.reduce((a, f) => a + f.total, 0) });
    },
  }).then((p) => p as unknown as Recognizer);
  recognizer.catch(() => (recognizer = null));
  return recognizer;
}

self.onmessage = async ({ data }: MessageEvent<SpeechRequest>) => {
  try {
    if (data.type === 'load') {
      await load();
      post({ type: 'ready' });
    } else {
      const run = await load();
      const out = await run(data.audio);
      post({ type: 'result', id: data.id, text: (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '' });
    }
  } catch (err) {
    post({ type: 'error', ...(data.type === 'transcribe' ? { id: data.id } : {}), message: err instanceof Error ? err.message : String(err) });
  }
};
