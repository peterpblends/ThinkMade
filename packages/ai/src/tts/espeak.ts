import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/**
 * Text to IPA phonemes for languages beyond English, with eSpeak NG (GPL-3.0, the `espeak-ng` package). Kokoro
 * speaks phonemes; kokoro-js only bundles eSpeak's English. This runs in the podcast worker only, never in
 * the app. The WebAssembly is compiled once; each call runs eSpeak's command line on a fresh instance.
 */

type ESpeakModule = { FS: { readFile: (path: string, o: { encoding: 'utf8' }) => string } };
type ESpeakFactory = (options: {
  arguments: string[];
  instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => object;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}) => Promise<ESpeakModule>;

let ready: Promise<{ factory: ESpeakFactory; wasm: WebAssembly.Module }> | null = null;
const load = () =>
  (ready ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasm = await WebAssembly.compile(await readFile(require.resolve('espeak-ng/dist/espeak-ng.wasm')));
    // The package ships no types (ESpeakFactory describes what is used), so it is imported by name.
    const pkg = 'espeak-ng';
    const factory = ((await import(pkg)) as { default: ESpeakFactory }).default;
    return { factory, wasm };
  })().catch((err) => {
    ready = null;
    throw err;
  }));

// One eSpeak run at a time: each holds its own memory.
let queue: Promise<unknown> = Promise.resolve();

async function phonemizeClause(text: string, voice: string): Promise<string> {
  const { factory, wasm } = await load();
  // A clause starting with "-" would be read as an option.
  const clause = text.replace(/^[\s-]+/, '').trim();
  if (!clause) return '';
  const run = async () => {
    const espeak = await factory({
      arguments: ['--phonout', 'phonemes.txt', '-q', '--ipa', '-b=1', '-v', voice, clause],
      instantiateWasm: (imports, receive) => {
        void WebAssembly.instantiate(wasm, imports).then(receive);
        return {};
      },
      print: () => {},
      printErr: () => {},
    });
    return espeak.FS.readFile('phonemes.txt', { encoding: 'utf8' }).replace(/\s+/g, ' ').trim();
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

/** Punctuation Kokoro reads as pauses and intonation; it is kept as written, between phonemized words. */
const PUNCTUATION = /(\s*[;:,.!?¡¿—…"«»“”()।]+\s*)+/g;

/**
 * IPA phonemes for `text` in an eSpeak voice (e.g. "es-419", "fr-fr"), with the punctuation kept, as Kokoro's
 * own English phonemizer does.
 */
export async function espeakPhonemes(text: string, voice: string): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(PUNCTUATION)) {
    if (m.index! > last) parts.push(await phonemizeClause(text.slice(last, m.index), voice));
    // Hindi's full stop (danda) reads as a full stop.
    parts.push(m[0].replace(/।/g, '.'));
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(await phonemizeClause(text.slice(last), voice));
  return parts.join('').replace(/\s+/g, ' ').trim();
}
