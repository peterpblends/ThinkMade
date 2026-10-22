import type { AppSettings, CreateGenerationInput, GenerationOptions } from '@thinkmade/shared';

const BITRATE = { compact: 48, balanced: 64, high: 96 } as const;

export class LimitError extends Error {}

/** Admin defaults, overridden by the user's customisation, never beyond admin limits. */
export function resolveOptions(settings: AppSettings, input: Pick<CreateGenerationInput, 'customization' | 'visibility'>): GenerationOptions {
  const p = settings.podcast;
  const c = input.customization ?? null;
  if (c && (c.lengthMinutes > p.maxEpisodeMinutes || c.episodes > p.maxEpisodesPerSeries)) {
    throw new LimitError(`Episodes can be up to ${p.maxEpisodeMinutes} minutes and a series up to ${p.maxEpisodesPerSeries} episodes.`);
  }
  return {
    lengthMinutes: c?.lengthMinutes ?? p.defaultLengthMinutes,
    episodes: c?.episodes ?? p.defaultEpisodes,
    speakerFormat: c?.speakerFormat ?? p.speakerFormat,
    learningMode: c?.learningMode ?? p.learningMode,
    visibility: input.visibility ?? p.visibility,
    language: p.language,
    teachingStyle: p.teachingStyle,
    voices: { single: settings.voices.single, hostA: settings.voices.hostA, hostB: settings.voices.hostB },
    bitrateKbps: BITRATE[p.audioQuality],
    maxTokens: settings.limits.maxTokensPerJob,
    maxAudioMinutes: settings.limits.maxAudioMinutesPerJob,
  };
}
