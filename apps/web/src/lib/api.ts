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
  /** A short spoken sample, once the worker has rendered one. */
  sampleUrl?: string;
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
