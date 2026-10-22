import { z } from 'zod';

export const speakerFormatSchema = z.enum(['single', 'two_hosts', 'mixed']);
export const learningModeSchema = z.enum(['explore', 'deepen', 'reinforce']);
export const visibilitySchema = z.enum(['private', 'public']);

export type SpeakerFormat = z.infer<typeof speakerFormatSchema>;
export type LearningMode = z.infer<typeof learningModeSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;

/** Durations a user may pick in Customize (minutes). Custom values up to maxEpisodeMinutes are also allowed. */
export const PODCAST_LENGTH_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;
export const EPISODE_COUNT_CHOICES = [1, 3, 5, 10] as const;

const podcastSchema = z.strictObject({
  defaultLengthMinutes: z.number().int().min(1).max(60),
  defaultEpisodes: z.number().int().min(1).max(50),
  maxEpisodeMinutes: z.number().int().min(1).max(60),
  maxEpisodesPerSeries: z.number().int().min(1).max(50),
  speakerFormat: speakerFormatSchema,
  learningMode: learningModeSchema,
  visibility: visibilitySchema,
  language: z.string().min(2).max(10),
  teachingStyle: z.string().min(1).max(200),
  sourceQuality: z.enum(['verified', 'verified_or_qualified']),
  audioQuality: z.enum(['compact', 'balanced', 'high']),
});

const voicesSchema = z.strictObject({
  single: z.string().min(1),
  hostA: z.string().min(1),
  hostB: z.string().min(1),
  available: z.array(z.string().min(1)).min(1),
});

const mediaSchema = z.strictObject({
  maxImages: z.number().int().min(0).max(20),
  maxImageBytes: z.number().int().min(0),
  maxVideoSeconds: z.number().int().min(0).max(600),
  maxVideoBytes: z.number().int().min(0),
  /** Days before uploaded photos and videos are deleted automatically. */
  retentionDays: z.number().int().min(1).max(3650).default(30),
});

const limitsSchema = z.strictObject({
  generationConcurrency: z.number().int().min(0).max(32),
  perUserDailyJobs: z.number().int().min(0).max(1000),
  maxTokensPerJob: z.number().int().min(0),
  maxAudioMinutesPerJob: z.number().int().min(0),
});

const qualitySchema = z.strictObject({
  /** Every criterion must score at least this (1–5) for a script to be voiced. */
  minScore: z.number().int().min(1).max(5),
  /** Rewrites allowed after the first review before an episode is held for human review. */
  maxRevisions: z.number().int().min(0).max(5),
});

const playerSchema = z.strictObject({
  /** Fraction of an episode after which it counts as completed. */
  completionThreshold: z.number().min(0.5).max(1),
});

const bugReportsSchema = z.strictObject({
  email: z.union([z.literal(''), z.email()]),
});

const settingsShape = {
  podcast: podcastSchema,
  voices: voicesSchema,
  media: mediaSchema,
  limits: limitsSchema,
  quality: qualitySchema.default({ minScore: 4, maxRevisions: 2 }),
  player: playerSchema.default({ completionThreshold: 0.95 }),
  bugReports: bugReportsSchema,
};

export const appSettingsSchema = z.strictObject(settingsShape).superRefine((value, ctx) => {
  if (value.podcast.defaultLengthMinutes > value.podcast.maxEpisodeMinutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['podcast', 'defaultLengthMinutes'],
      message: 'Default length cannot exceed the maximum episode length.',
    });
  }
  if (value.podcast.defaultEpisodes > value.podcast.maxEpisodesPerSeries) {
    ctx.addIssue({
      code: 'custom',
      path: ['podcast', 'defaultEpisodes'],
      message: 'Default episode count cannot exceed the maximum series length.',
    });
  }
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

/** A partial update: any subset of sections, each with any subset of keys. Unknown keys are rejected. */
export const appSettingsPatchSchema = z.strictObject({
  podcast: podcastSchema.partial().optional(),
  voices: voicesSchema.partial().optional(),
  media: mediaSchema.partial().optional(),
  limits: limitsSchema.partial().optional(),
  quality: qualitySchema.partial().optional(),
  player: playerSchema.partial().optional(),
  bugReports: bugReportsSchema.partial().optional(),
});

export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

/** Kokoro voice ids. af_heart is the highest-rated voice in the Kokoro model card. */
export const KOKORO_VOICES = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_michael',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_lewis',
] as const;

/** Spec §8 initial defaults. The admin dashboard edits these; code never hardcodes them elsewhere. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  podcast: {
    defaultLengthMinutes: 15,
    defaultEpisodes: 3,
    maxEpisodeMinutes: 60,
    maxEpisodesPerSeries: 10,
    speakerFormat: 'mixed',
    learningMode: 'explore',
    visibility: 'private',
    language: 'en',
    teachingStyle: 'conversational_practical',
    sourceQuality: 'verified',
    audioQuality: 'balanced',
  },
  voices: {
    single: 'af_heart',
    hostA: 'af_heart',
    hostB: 'am_michael',
    available: [...KOKORO_VOICES],
  },
  media: {
    maxImages: 4,
    maxImageBytes: 10_485_760,
    maxVideoSeconds: 120,
    maxVideoBytes: 104_857_600,
    retentionDays: 30,
  },
  limits: {
    generationConcurrency: 2,
    perUserDailyJobs: 5,
    maxTokensPerJob: 400_000,
    maxAudioMinutesPerJob: 240,
  },
  quality: {
    minScore: 4,
    maxRevisions: 2,
  },
  player: {
    completionThreshold: 0.95,
  },
  bugReports: {
    email: '',
  },
};

/** Deep-merge a patch onto settings and validate the result. Throws ZodError on an invalid outcome. */
export function applySettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const merged = {
    podcast: { ...current.podcast, ...patch.podcast },
    voices: { ...current.voices, ...patch.voices },
    media: { ...current.media, ...patch.media },
    limits: { ...current.limits, ...patch.limits },
    quality: { ...current.quality, ...patch.quality },
    player: { ...current.player, ...patch.player },
    bugReports: { ...current.bugReports, ...patch.bugReports },
  };
  return appSettingsSchema.parse(merged);
}
