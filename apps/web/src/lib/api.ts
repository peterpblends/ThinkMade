import type { FeatureKey } from '@thinkmade/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(`${status} ${code}`);
    // The terms changed since this person last agreed: the app asks them to agree again.
    if (code === 'terms_required' && typeof window !== 'undefined') window.dispatchEvent(new Event(TERMS_REQUIRED_EVENT));
  }
}

/** Fired when the server needs the person to agree to the current terms first. */
export const TERMS_REQUIRED_EVENT = 'thinkmade:terms-required';

/** A reply's JSON. An error page that isn't JSON (a platform error) still becomes an ApiError, not a crash. */
function parseBody(text: string, ok: boolean): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    if (ok) throw err;
    return null;
  }
}

/**
 * What to tell someone when the app can't load from the server: the server's own words when it is briefly
 * unavailable (503), that they seem offline only when their device says so, and otherwise a plain retry.
 */
export function unreachableMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 503) {
    const message = (err.body as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : 'ThinkMade is briefly unavailable. Please try again in a little while.';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You seem to be offline. Please try again when you're connected.";
  return "ThinkMade can't reach its server right now. Please try again in a moment.";
}

/** Same-origin JSON fetch with cookies. Throws ApiError on non-2xx. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  const body = parseBody(text, res.ok);
  if (!res.ok) {
    const code = (body as { error?: string } | null)?.error ?? 'request_failed';
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}

/**
 * POSTs JSON and reads a streamed reply (server-sent events): `onText` gets the reply so far as each piece
 * arrives; resolves with the final "done" event's data. Falls back to a plain JSON reply.
 */
export async function streamApi<T>(path: string, body: unknown, onText: (soFar: string) => void, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream') || !res.body) {
    const text = await res.text();
    const data = parseBody(text, res.ok);
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'request_failed', data);
    return data as T;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let soFar = '';
  let result: T | undefined;
  const handle = (block: string) => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
    }
    if (!data) return;
    const parsed = JSON.parse(data) as { text?: string; error?: string };
    if (event === 'delta' && parsed.text) {
      soFar += parsed.text;
      onText(soFar);
    } else if (event === 'done') result = parsed as T;
    else if (event === 'error') throw new ApiError(502, parsed.error ?? 'request_failed', parsed);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      handle(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  if (result === undefined) throw new ApiError(502, 'stream_ended', { message: 'The reply was cut off. Please try again.' });
  return result;
}

/** Wakes the server (and its database connection) so the next request isn't slowed by a cold start. */
export function warmServer() {
  void fetch('/api/health?warm=1', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
}

/** One spoken turn of a conversation, transcribed accurately on the server. */
export async function transcribeTurn(audio: Blob, opts: { language: string; hint?: string }, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set('audio', new File([audio], 'turn.wav', { type: audio.type || 'audio/wav' }));
  form.set('language', opts.language);
  if (opts.hint) form.set('prompt', opts.hint);
  const res = await fetch('/api/transcribe/turn', { method: 'POST', body: form, credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (!res.ok) throw new ApiError(res.status, 'transcribe_failed', null);
  return ((await res.json()) as { text?: string }).text ?? '';
}

export interface PublicPodcastSettings {
  defaultLengthMinutes: number;
  defaultEpisodes: number;
  maxEpisodeMinutes: number;
  maxEpisodesPerSeries: number;
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  learningMode: 'explore' | 'deepen' | 'reinforce';
  visibility: 'private' | 'public';
  lengthChoices: number[];
  episodeChoices: number[];
}

export interface VoiceOption {
  id: string;
  name: string;
  accent: 'US' | 'UK';
  gender: 'female' | 'male';
  /** American English with another heritage's accent. */
  heritage?: 'latino' | 'south-asian' | 'east-asian';
  /** A short spoken sample, once the worker has rendered one. */
  sampleUrl?: string;
  /** Languages the voice can speak a podcast in. */
  speaks?: string[];
  /** A sample in each language it speaks, once rendered. */
  sampleUrls?: Record<string, string>;
}

export interface PublicSettings {
  podcast: PublicPodcastSettings;
  media: { maxImages: number; maxImageBytes: number; maxVideoSeconds: number; maxVideoBytes: number };
  voices?: VoiceOption[];
  /** Features an administrator has switched on or off. */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** The opening splash's length, set by an administrator (0: no splash). */
  splash?: { seconds: number };
}
