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

/** What an administrator noted about a voice after listening: how old it sounds, and whether to cast it. */
export const voiceProfileSchema = z.strictObject({
  age: z.enum(['young', 'adult', 'mature']).optional(),
  note: z.string().max(200).optional(),
  /** Cast automatically. Unset: Phonon voices and well-graded Kokoro voices are. */
  autoCast: z.boolean().optional(),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

const voicesSchema = z.strictObject({
  single: z.string().min(1),
  hostA: z.string().min(1),
  hostB: z.string().min(1),
  available: z.array(z.string().min(1)).min(1),
  profiles: z.record(z.string(), voiceProfileSchema).default({}),
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

/** How podcasts are produced: show format, host style and delivery. */
export const showFormatSchema = z.enum(['storytelling', 'conversation', 'interview']);
export type ShowFormat = z.infer<typeof showFormatSchema>;
const productionSchema = z.strictObject({
  /** "auto" lets each topic (and the listener's request) decide. */
  showFormat: z.enum(['auto', 'storytelling', 'conversation', 'interview']),
  /** Interviews may feature a simulated expert guest, always introduced as simulated. */
  allowSimulatedGuests: z.boolean(),
  /** In an interview series, one host throughout and a different guest, suited to the topic, each episode. */
  rotateGuests: z.boolean().default(true),
  /** Extra direction for every host, e.g. "warm and plain-spoken, with dry humour". */
  hostStyle: z.string().max(400),
  /** Pauses between lines and speakers. */
  pacing: z.enum(['relaxed', 'natural', 'brisk']),
  /** How much the voices vary their delivery. */
  expressiveness: z.enum(['steady', 'natural', 'expressive']),
  /** A very quiet room tone under the audio so silences don't sound like dead air. */
  roomTone: z.boolean(),
});
export type ProductionSettings = z.infer<typeof productionSchema>;
export const DEFAULT_PRODUCTION: ProductionSettings = {
  showFormat: 'auto',
  allowSimulatedGuests: true,
  rotateGuests: true,
  hostStyle: '',
  pacing: 'natural',
  expressiveness: 'natural',
  roomTone: true,
};

const playerSchema = z.strictObject({
  /** Fraction of an episode after which it counts as completed. */
  completionThreshold: z.number().min(0.5).max(1),
});

/** Optional unit prices for the cost estimate (0 on free tiers). */
const costsSchema = z.strictObject({
  llmPerMillionTokensUsd: z.number().min(0),
  ttsPerHourUsd: z.number().min(0),
  storagePerGbMonthUsd: z.number().min(0),
});

/** Free-tier allowances the dashboard warns about at 80%. */
const alertsSchema = z.strictObject({
  storageGb: z.number().min(0),
  databaseMb: z.number().min(0),
  dailyLlmTokens: z.number().int().min(0),
  monthlyEmails: z.number().int().min(0),
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
  production: productionSchema.default(DEFAULT_PRODUCTION),
  player: playerSchema.default({ completionThreshold: 0.95 }),
  costs: costsSchema.default({ llmPerMillionTokensUsd: 0, ttsPerHourUsd: 0, storagePerGbMonthUsd: 0 }),
  alerts: alertsSchema.default({ storageGb: 10, databaseMb: 1024, dailyLlmTokens: 100_000, monthlyEmails: 3000 }),
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
  production: productionSchema.partial().optional(),
  player: playerSchema.partial().optional(),
  costs: costsSchema.partial().optional(),
  alerts: alertsSchema.partial().optional(),
  bugReports: bugReportsSchema.partial().optional(),
});

export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

/**
 * Phonon-31M voices (Apache-2.0, gradium/phonon-voices). Stored as `phonon:<key>`. Phonon is the
 * default engine; Kokoro voices stay available and are the fallback if Phonon can't load.
 */
export const PHONON_VOICES = [
  { key: 'zoey', id: 'NbpkqMVS3CJeq2j8', name: 'Zoey', accent: 'US', gender: 'female' },
  { key: 'juniper', id: 'NIWIOv5vTi5eRMj8', name: 'Juniper', accent: 'US', gender: 'female' },
  { key: 'everly', id: 'vjFyp2BcCyTlUmYb', name: 'Everly', accent: 'US', gender: 'female' },
  { key: 'harper', id: '4SZHfMpw-p46Ywgs', name: 'Harper', accent: 'US', gender: 'female' },
  { key: 'hadley', id: 'bXwrkHhURL1VFJdG', name: 'Hadley', accent: 'US', gender: 'female' },
  { key: 'delia', id: 'nGzMHMPAWGaJFHOo', name: 'Delia', accent: 'US', gender: 'female' },
  { key: 'easton', id: 'LMDIYE0Oa377Qh6Z', name: 'Easton', accent: 'US', gender: 'male' },
  { key: 'micah', id: '40QrMVgAxFiUnP9f', name: 'Micah', accent: 'US', gender: 'male' },
  { key: 'trevor', id: '0zLApsZfVLLNaEGl', name: 'Trevor', accent: 'US', gender: 'male' },
  { key: 'russell', id: '_6Aslh2DxfmnRLmP', name: 'Russell', accent: 'US', gender: 'male' },
  { key: 'preston', id: 'qIxlZ7Ei8KvWlyQH', name: 'Preston', accent: 'US', gender: 'male' },
  { key: 'miles', id: 'd9XCyhjo4JhkHF1d', name: 'Miles', accent: 'US', gender: 'male' },
  { key: 'maeve', id: '6PWnV0Nq4wu7RVBT', name: 'Maeve', accent: 'UK', gender: 'female' },
  { key: 'freya', id: 'GgfEkEJtxZR7gnpy', name: 'Freya', accent: 'UK', gender: 'female' },
  { key: 'pippa', id: 'uem82D50GRv2Dwma', name: 'Pippa', accent: 'UK', gender: 'female' },
  { key: 'elodie-rose', id: 'y9bQqIDnyxwqK01t', name: 'Elodie-Rose', accent: 'UK', gender: 'female' },
  { key: 'imogen', id: 'gDT1nz7Ie36ZhL-C', name: 'Imogen', accent: 'UK', gender: 'female' },
  { key: 'lottie', id: 'm9MxpY6IUGXtWp76', name: 'Lottie', accent: 'UK', gender: 'female' },
  { key: 'bryony', id: 'gfP44RlHwr2kEwk7', name: 'Bryony', accent: 'UK', gender: 'female' },
  { key: 'alfie', id: 'X6NceqF285Gr04gb', name: 'Alfie', accent: 'UK', gender: 'male' },
  { key: 'hugh', id: 'YyKcxPG7iIgS3jsK', name: 'Hugh', accent: 'UK', gender: 'male' },
  { key: 'edwin', id: 'zUCxzrOrugTSis03', name: 'Edwin', accent: 'UK', gender: 'male' },
  { key: 'spencer', id: 'JOW0vchyswkQUMDS', name: 'Spencer', accent: 'UK', gender: 'male' },
  { key: 'toby', id: 'dME3IWyZBvmh1n1q', name: 'Toby', accent: 'UK', gender: 'male' },
  { key: 'teddy', id: 'Zn7g6NxLqXlJb7Qi', name: 'Teddy', accent: 'UK', gender: 'male' },
] as const;

export type PhononVoice = (typeof PHONON_VOICES)[number];

export function phononVoice(voice: string): PhononVoice | undefined {
  return voice.startsWith('phonon:') ? PHONON_VOICES.find((v) => v.key === voice.slice(7)) : undefined;
}

/**
 * Kokoro's English voices (bundled with kokoro-js, Apache-2.0), stored by their ids. `name` is the host name
 * used when a listener doesn't name their hosts; am_santa is left out as a novelty voice. `grade` is the
 * overall grade from the Kokoro model card (VOICES.md); af_nicole is a whispered "headphones" voice.
 */
export const KOKORO_VOICE_INFO = [
  { id: 'af_heart', name: 'Hannah', accent: 'US', gender: 'female', grade: 'A' },
  { id: 'af_alloy', name: 'Allison', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_aoede', name: 'Audrey', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'female', grade: 'A-' },
  { id: 'af_jessica', name: 'Jessica', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'af_kore', name: 'Cora', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'female', grade: 'B-', style: 'whisper' },
  { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_river', name: 'River', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_sky', name: 'Skye', accent: 'US', gender: 'female', grade: 'C-' },
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'male', grade: 'F+' },
  { id: 'am_echo', name: 'Ethan', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_fenrir', name: 'Finn', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_onyx', name: 'Owen', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_puck', name: 'Parker', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'female', grade: 'B-' },
  { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'female', grade: 'C' },
  { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'male', grade: 'D' },
  { id: 'bm_fable', name: 'Felix', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'male', grade: 'D+' },
] as const;

/** Kokoro voice ids. af_heart is the highest-rated voice in the Kokoro model card. */
export const KOKORO_VOICES = KOKORO_VOICE_INFO.map((v) => v.id);

export interface VoiceInfo {
  /** Stored id: `phonon:<key>` or a Kokoro id. */
  id: string;
  /** A person's name that suits the voice. */
  name: string;
  engine: 'Phonon' | 'Kokoro';
  accent: 'US' | 'UK';
  gender: 'female' | 'male';
  /** Kokoro model card grade, where the engine publishes one. */
  grade?: string;
  /** A voice made for a special style (e.g. whispering), unsuited to most podcasts. */
  style?: 'whisper';
}

/**
 * Whether a voice is good enough to be cast automatically for a professional podcast: Phonon voices, and
 * Kokoro voices graded C- or better that aren't a special style. Anything can still be picked by hand.
 */
export function castableByDefault(v: VoiceInfo): boolean {
  if (v.style) return false;
  return !v.grade || /^[ABC]/.test(v.grade);
}

/** Every voice ThinkMade can speak with. */
export const VOICE_CATALOG: readonly VoiceInfo[] = [
  ...PHONON_VOICES.map((v) => ({ id: `phonon:${v.key}`, name: v.name, engine: 'Phonon' as const, accent: v.accent, gender: v.gender })),
  ...KOKORO_VOICE_INFO.map((v) => ({ id: v.id, name: v.name, engine: 'Kokoro' as const, accent: v.accent, gender: v.gender, grade: v.grade, ...('style' in v ? { style: v.style } : {}) })),
];

export function voiceInfo(voice: string): VoiceInfo | undefined {
  return VOICE_CATALOG.find((v) => v.id === voice);
}

/** A readable label for a stored voice id, e.g. "Zoey (Phonon, US female)". */
export function voiceLabel(voice: string): string {
  const v = voiceInfo(voice);
  return v ? `${v.name} (${v.engine}, ${v.accent} ${v.gender})` : `${voice} (Kokoro)`;
}

/** The voices offered before the full Kokoro set was added; a stored list equal to this is upgraded. */
const LEGACY_AVAILABLE_VOICES = [
  ...PHONON_VOICES.map((v) => `phonon:${v.key}`),
  ...['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'],
];

/**
 * Brings a stored settings document up to date: a voice list that still matches an earlier default gains the
 * voices added since. A list an administrator changed is left alone.
 */
export function upgradeAppSettings(settings: AppSettings): AppSettings {
  const a = settings.voices.available;
  if (a.length === LEGACY_AVAILABLE_VOICES.length && LEGACY_AVAILABLE_VOICES.every((v) => a.includes(v))) {
    return { ...settings, voices: { ...settings.voices, available: VOICE_CATALOG.map((v) => v.id) } };
  }
  return settings;
}

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
    single: 'phonon:zoey',
    hostA: 'phonon:zoey',
    hostB: 'phonon:easton',
    available: VOICE_CATALOG.map((v) => v.id),
    profiles: {},
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
  production: DEFAULT_PRODUCTION,
  player: {
    completionThreshold: 0.95,
  },
  costs: {
    llmPerMillionTokensUsd: 0,
    ttsPerHourUsd: 0,
    storagePerGbMonthUsd: 0,
  },
  alerts: {
    storageGb: 10,
    databaseMb: 1024,
    dailyLlmTokens: 100_000,
    monthlyEmails: 3000,
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
    production: { ...current.production, ...patch.production },
    player: { ...current.player, ...patch.player },
    costs: { ...current.costs, ...patch.costs },
    alerts: { ...current.alerts, ...patch.alerts },
    bugReports: { ...current.bugReports, ...patch.bugReports },
  };
  return appSettingsSchema.parse(merged);
}
