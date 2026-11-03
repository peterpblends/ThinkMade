import type { FeatureKey } from '@thinkmade/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(`${status} ${code}`);
  }
}

/** Same-origin JSON fetch with cookies. Throws ApiError on non-2xx. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
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
    const data: unknown = text ? JSON.parse(text) : null;
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
