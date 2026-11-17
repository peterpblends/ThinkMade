import { GEMINI_VOICES } from '@thinkmade/shared';
import type { DialogueLine, SpeakOptions, SpeechAudio, TtsEngine } from './types';

/** Newest first: a model the key can't use is skipped for the next. */
export const GEMINI_TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'] as const;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's speech service is busy or the key's allowance is used up for now: try again later. */
export class TtsRateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'TtsRateLimitedError';
  }
}

export interface GeminiTtsOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** Longest single wait for the rate limit to clear before giving up on this request (ms). */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  models?: readonly string[];
}

const voiceName = (voice: string) => voice.replace(/^gemini:/, '');

/**
 * How the lines should sound. Gemini's speech models follow a director's note in plain words; this one asks
 * for real people talking, not an announcer reading.
 */
export function directorNote(lines: Array<Pick<DialogueLine, 'speaker'>>, language?: string): string {
  const people = [...new Set(lines.map((l) => l.speaker))];
  const lang = language && language !== 'en' ? ` Speak in the language the lines are written in.` : '';
  return people.length > 1
    ? `Perform this as a real, relaxed podcast conversation between ${people.join(' and ')}: two people who know each other well, talking naturally and warmly, with genuine reactions, natural rhythm and pace, light laughter only where it fits, and no announcer voice. Never read the speaker names aloud.${lang}`
    : `Perform this as ${people[0] ?? 'the host'} of a podcast, talking naturally to one listener: warm, engaged and conversational, varying pace and energy like a real storyteller, never like an announcer reading.${lang}`;
}

/** Gemini's own expressive cues that may stay in the text (others are removed before speaking). */
export const SPEECH_CUES = ['laughs', 'chuckles', 'sighs', 'short pause', 'pause'] as const;

function decodePcm(b64: string): Float32Array {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(i * 2) / 32768;
  return out;
}

/** Waits Gemini asks for, read from its error ("retryDelay": "37s") or the Retry-After header. */
function retryAfterMs(res: Response, body: string): number {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  const h = Number(res.headers.get('retry-after'));
  return Number.isFinite(h) && h > 0 ? h * 1000 : 30_000;
}

/**
 * Gemini's speech models: the most natural-sounding voices available to ThinkMade. A conversation between two
 * people is performed in one request, so turn-taking, timing and reactions sound like real people. Voices are
 * `gemini:<Name>` from GEMINI_VOICES.
 */
export function createGeminiTts(options: GeminiTtsOptions): TtsEngine & { synthesizeDialogue: NonNullable<TtsEngine['synthesizeDialogue']>; available(): Promise<boolean> } {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxWaitMs = options.maxWaitMs ?? 90_000;
  const models = [...(options.models ?? GEMINI_TTS_MODELS)];
  let model = 0;

  async function generate(text: string, speechConfig: Record<string, unknown>): Promise<SpeechAudio> {
    let waited = 0;
    for (;;) {
      const name = models[model];
      if (!name) throw new Error('No Gemini speech model is available to this key.');
      const res = await doFetch(`${BASE}/models/${name}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } }),
      });
      const body = await res.text();
      if (res.status === 429 || res.status === 503) {
        const wait = retryAfterMs(res, body);
        if (waited + wait > maxWaitMs) throw new TtsRateLimitedError(`Gemini speech is rate limited (${res.status}); try again in ${Math.round(wait / 1000)}s.`, wait);
        waited += wait;
        await sleep(wait);
        continue;
      }
      if (res.status === 404 || (res.status === 400 && /not (found|supported)|unsupported/i.test(body)) || (res.status === 403 && /not available|permission/i.test(body))) {
        // This key or region can't use this model: use the next one.
        model++;
        continue;
      }
      if (!res.ok) throw new Error(`Gemini speech failed (${res.status}): ${body.slice(0, 300)}`);
      const json = JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const audio = parts.filter((p) => p.inlineData?.data);
      if (!audio.length) throw new Error('Gemini speech returned no audio.');
      const rate = Number(audio[0]!.inlineData!.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
      const chunks = audio.map((p) => decodePcm(p.inlineData!.data!));
      const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        samples.set(c, o);
        o += c.length;
      }
      return { samples, sampleRate: rate };
    }
  }

  return {
    /**
     * Whether this key can use a Gemini speech model, asked without generating speech (which would use up
     * the allowance): the first model the key can see is used from then on.
     */
    async available() {
      for (let i = model; i < models.length; i++) {
        try {
          const res = await doFetch(`${BASE}/models/${models[i]}`, { headers: { 'x-goog-api-key': options.apiKey } });
          if (res.ok) {
            model = i;
            return true;
          }
          if (res.status === 429 || res.status >= 500) return true;
        } catch {
          return true;
        }
      }
      return false;
    },
    name: 'gemini',
    sampleRate: 24_000,
    handles: (voice: string) => voice.startsWith('gemini:') && GEMINI_VOICES.some((v) => v.key === voiceName(voice)),
    async synthesize(text: string, voice: string, speak?: SpeakOptions) {
      const note = directorNote([{ speaker: 'the host' }], speak?.language);
      return generate(`${note}\n\n${text}`, { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName(voice) } } });
    },
    async synthesizeDialogue(lines: DialogueLine[], speak?: SpeakOptions) {
      const people = [...new Map(lines.map((l) => [l.speaker, l.voice])).entries()];
      if (people.length > 2) throw new Error('Gemini speaks at most two people in one request.');
      const note = directorNote(lines, speak?.language);
      if (people.length === 1) return generate(`${note}\n\n${lines.map((l) => l.text).join('\n')}`, { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName(people[0]![1]) } } });
      const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
      return generate(`${note}\n\n${transcript}`, {
        multiSpeakerVoiceConfig: { speakerVoiceConfigs: people.map(([speaker, voice]) => ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName(voice) } } })) },
      });
    },
  };
}
