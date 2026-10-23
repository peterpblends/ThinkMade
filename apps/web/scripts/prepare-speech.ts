/**
 * Puts the on-device speech recogniser into public/speech so the app serves it itself: listeners'
 * phones never contact a third party, and the content security policy needs no extra hosts.
 *   - Moonshine base (MIT), q8: about 67 MB, downloaded once into .data/models and checked by SHA-256.
 *   - The ONNX Runtime WebAssembly files that Transformers.js loads.
 * Runs before `vite` and `vite build`. Set SKIP_SPEECH_MODEL=1 to skip the download (voice input
 * then uses the server or the browser's own recogniser).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'speech');
const cache = resolve(web, '..', '..', '.data', 'models', 'web-speech');

const REPO = 'onnx-community/moonshine-base-ONNX';
const REVISION = 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad';
/** Small JSON files are pinned by the revision; the model weights also by their LFS hash. */
const FILES: Array<[string, string?]> = [
  ['config.json'],
  ['generation_config.json'],
  ['preprocessor_config.json'],
  ['special_tokens_map.json'],
  ['tokenizer.json'],
  ['tokenizer_config.json'],
  ['onnx/encoder_model_quantized.onnx', '1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751'],
  ['onnx/decoder_model_merged_quantized.onnx', 'cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3'],
];
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

async function fetchModelFile(path: string, sha256?: string): Promise<string> {
  const local = join(cache, REVISION, path);
  if (!existsSync(local)) {
    const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${path}`);
    if (!res.ok) throw new Error(`Download of ${path} failed with ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(`${local}.part`, bytes);
    renameSync(`${local}.part`, local);
  }
  if (sha256) {
    const actual = createHash('sha256').update(readFileSync(local)).digest('hex');
    if (actual !== sha256) throw new Error(`${path} has the wrong SHA-256 (${actual}). Delete ${local} and try again.`);
  }
  return local;
}

if (process.env.SKIP_SPEECH_MODEL === '1') {
  console.info('[speech] skipped (SKIP_SPEECH_MODEL=1)');
} else {
  for (const [path, sha] of FILES) {
    const dest = join(out, 'models', REPO, path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(await fetchModelFile(path, sha), dest);
  }
  const require = createRequire(createRequire(join(web, 'package.json')).resolve('@huggingface/transformers'));
  const ortDist = dirname(require.resolve('onnxruntime-web'));
  mkdirSync(join(out, 'ort'), { recursive: true });
  for (const f of ORT_FILES) copyFileSync(join(ortDist, f), join(out, 'ort', f));
  console.info(`[speech] Moonshine base and ONNX Runtime ready in ${out}`);
}
