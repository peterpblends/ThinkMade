import { z } from 'zod';
import { languageInfo, SAMPLE_LINES, type LanguageCode } from './languages.ts';

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
  /**
   * When the rewrites run out, the whole episode is written again from scratch (told what failed) this many
   * times, each with its own rewrites, before it is held for human review.
   */
  maxRegenerations: z.number().int().min(0).max(3).default(2),
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

/** Features an administrator can switch on or off. */
export const FEATURE_KEYS = ['coach', 'voiceCoaching', 'voiceInput', 'mediaUploads', 'accentVoices', 'languages', 'naturalDelivery', 'showArtwork'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const FEATURE_INFO: Record<FeatureKey, { label: string; description: string }> = {
  coach: { label: 'Coach Me', description: 'Listeners can ask a coach about any episode.' },
  voiceCoaching: { label: 'Talk with your coach', description: 'A hands-free spoken conversation with the coach (needs Coach Me).' },
  voiceInput: { label: 'Voice input', description: 'Listeners can speak their question instead of typing it.' },
  mediaUploads: { label: 'Photos and videos', description: 'Listeners can add photos and videos to their request.' },
  accentVoices: { label: 'More accents', description: 'American voices with Latino, South Asian and East Asian accents.' },
  languages: { label: 'Other languages', description: 'Podcasts in Spanish, French, Portuguese (Brazil), Italian and Hindi, with native voices.' },
  naturalDelivery: { label: 'Natural delivery', description: 'Conversational phrasing, breathing room and a warmer, less synthetic sound in new episodes.' },
  showArtwork: { label: 'Show artwork', description: 'A cover image with the title for every podcast show.' },
};
const featuresSchema = z.strictObject(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>);
export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>;

/** How the app looks and opens. */
const appearanceSchema = z.strictObject({
  /** How long the opening splash shows, in seconds (0 turns it off). */
  splashSeconds: z.number().min(0).max(10),
});
export const DEFAULT_SPLASH_SECONDS = 2.3;

const bugReportsSchema = z.strictObject({
  email: z.union([z.literal(''), z.email()]),
});

const settingsShape = {
  podcast: podcastSchema,
  voices: voicesSchema,
  media: mediaSchema,
  limits: limitsSchema,
  quality: qualitySchema.default({ minScore: 4, maxRevisions: 2, maxRegenerations: 2 }),
  production: productionSchema.default(DEFAULT_PRODUCTION),
  player: playerSchema.default({ completionThreshold: 0.95 }),
  costs: costsSchema.default({ llmPerMillionTokensUsd: 0, ttsPerHourUsd: 0, storagePerGbMonthUsd: 0 }),
  alerts: alertsSchema.default({ storageGb: 10, databaseMb: 1024, dailyLlmTokens: 100_000, monthlyEmails: 3000 }),
  appearance: appearanceSchema.default({ splashSeconds: DEFAULT_SPLASH_SECONDS }),
  // Older documents get any feature added since switched on.
  features: z.preprocess((v) => ({ ...DEFAULT_FEATURES, ...(v as object | undefined) }), featuresSchema),
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
  appearance: appearanceSchema.partial().optional(),
  features: featuresSchema.partial().optional(),
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

/** American English with another heritage's accent: the voice of a native speaker of another language. */
export type Heritage = 'latino' | 'south-asian' | 'east-asian';
export const HERITAGE_LABEL: Record<Heritage, string> = { latino: 'Latino', 'south-asian': 'South Asian', 'east-asian': 'East Asian' };

/**
 * Phonon voices of native Mexican Spanish speakers (from Phonon's voice catalog), speaking English through the
 * English model: American English with a Latino accent. Not cast automatically until an administrator has
 * listened and switched them on, since the catalog made them for Spanish.
 */
export const PHONON_HERITAGE_VOICES = [
  { key: 'regina', id: 's58clrg2fe0MO7Y-', name: 'Regina', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'ximena', id: 'VDwnGxAo68C8U8vC', name: 'Ximena', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'rebeca', id: 'Sx8m6WdXBG06zwZT', name: 'Rebeca', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'danae', id: 'evfxKSxpDIhmsNoq', name: 'Danae', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'jimena', id: 'qG5BXOJYrKEnXLIX', name: 'Jimena', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'azucena', id: 'KJpIQlbYrZPA4aLq', name: 'Azucena', accent: 'US', gender: 'female', heritage: 'latino' },
  { key: 'lalo', id: 'F05gqkzX7WhKVpSL', name: 'Lalo', accent: 'US', gender: 'male', heritage: 'latino' },
  { key: 'aldo', id: 'ax7dW1XB0eiMfHgO', name: 'Aldo', accent: 'US', gender: 'male', heritage: 'latino' },
  { key: 'yael', id: 'ALczEazoF4n6PmGl', name: 'Yael', accent: 'US', gender: 'male', heritage: 'latino' },
  { key: 'nico', id: 'PwgPEaweQILZdGc4', name: 'Nico', accent: 'US', gender: 'male', heritage: 'latino' },
  { key: 'ulises', id: 'G5HLUsQd659UtRe7', name: 'Ulises', accent: 'US', gender: 'male', heritage: 'latino' },
  { key: 'leonel', id: 'BkuASiOJRrJEB5qA', name: 'Leonel', accent: 'US', gender: 'male', heritage: 'latino' },
] as const;

export type PhononVoice = (typeof PHONON_VOICES)[number] | (typeof PHONON_HERITAGE_VOICES)[number];

export function phononVoice(voice: string): PhononVoice | undefined {
  if (!voice.startsWith('phonon:')) return undefined;
  const key = voice.slice(7);
  return PHONON_VOICES.find((v) => v.key === key) ?? PHONON_HERITAGE_VOICES.find((v) => v.key === key);
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

/**
 * Kokoro's voices for other languages (bundled with kokoro-js), speaking English: American English with a
 * South Asian (Hindi voices), East Asian (Japanese and Mandarin voices) or Latino (Spanish voices) accent.
 * `grade` is the model card's grade in the voice's own language. Not cast automatically until an
 * administrator has listened and switched them on.
 */
export const KOKORO_HERITAGE_VOICES = [
  { id: 'hf_alpha', name: 'Priya', accent: 'US', gender: 'female', heritage: 'south-asian', grade: 'C' },
  { id: 'hf_beta', name: 'Anika', accent: 'US', gender: 'female', heritage: 'south-asian', grade: 'C' },
  { id: 'hm_omega', name: 'Arjun', accent: 'US', gender: 'male', heritage: 'south-asian', grade: 'C' },
  { id: 'hm_psi', name: 'Rohan', accent: 'US', gender: 'male', heritage: 'south-asian', grade: 'C' },
  { id: 'jf_alpha', name: 'Yuki', accent: 'US', gender: 'female', heritage: 'east-asian', grade: 'C+' },
  { id: 'jf_gongitsune', name: 'Hana', accent: 'US', gender: 'female', heritage: 'east-asian', grade: 'C' },
  { id: 'jf_tebukuro', name: 'Aiko', accent: 'US', gender: 'female', heritage: 'east-asian', grade: 'C' },
  { id: 'jm_kumo', name: 'Kenji', accent: 'US', gender: 'male', heritage: 'east-asian', grade: 'C-' },
  { id: 'zf_xiaoxiao', name: 'Mei', accent: 'US', gender: 'female', heritage: 'east-asian', grade: 'D' },
  { id: 'zf_xiaoyi', name: 'Lin', accent: 'US', gender: 'female', heritage: 'east-asian', grade: 'D' },
  { id: 'zm_yunxi', name: 'Wei', accent: 'US', gender: 'male', heritage: 'east-asian', grade: 'D' },
  { id: 'zm_yunjian', name: 'Jian', accent: 'US', gender: 'male', heritage: 'east-asian', grade: 'D' },
  { id: 'ef_dora', name: 'Dora', accent: 'US', gender: 'female', heritage: 'latino' },
  { id: 'em_alex', name: 'Alejandro', accent: 'US', gender: 'male', heritage: 'latino' },
] as const;

/**
 * Kokoro voices that speak only their own language (bundled with kokoro-js): French, Italian and Brazilian
 * Portuguese podcasts. `grade` is the model card's.
 */
export const KOKORO_NATIVE_VOICES = [
  { id: 'ff_siwis', name: 'Camille', gender: 'female', speaks: 'fr', grade: 'B-' },
  { id: 'if_sara', name: 'Sara', gender: 'female', speaks: 'it', grade: 'C' },
  { id: 'im_nicola', name: 'Nicola', gender: 'male', speaks: 'it', grade: 'C' },
  { id: 'pf_dora', name: 'Beatriz', gender: 'female', speaks: 'pt-br' },
  { id: 'pm_alex', name: 'Rafael', gender: 'male', speaks: 'pt-br' },
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
  /** American English with another heritage's accent (a native speaker of another language). */
  heritage?: Heritage;
  /** Languages this voice can speak a podcast in: English, and the voice's own language where the engine supports it. */
  speaks: readonly LanguageCode[];
}

/**
 * Whether a voice is good enough to be cast automatically for a professional podcast: Phonon voices, and
 * Kokoro voices graded C- or better that aren't a special style. Anything can still be picked by hand.
 */
export function castableByDefault(v: VoiceInfo): boolean {
  // Made for other styles or languages: an administrator switches these on after listening.
  if (v.style || v.heritage) return false;
  return !v.grade || /^[ABC]/.test(v.grade);
}

/** Every voice ThinkMade can speak with. */
/** Kokoro speaks other languages from its Hindi and Spanish voices; its Japanese and Mandarin ones need tools it lacks. */
const KOKORO_OWN_LANGUAGE: Record<string, LanguageCode> = { e: 'es', h: 'hi' };

export const VOICE_CATALOG: readonly VoiceInfo[] = [
  ...PHONON_VOICES.map((v) => ({ id: `phonon:${v.key}`, name: v.name, engine: 'Phonon' as const, accent: v.accent, gender: v.gender, speaks: ['en'] as const })),
  ...KOKORO_VOICE_INFO.map((v) => ({ id: v.id, name: v.name, engine: 'Kokoro' as const, accent: v.accent, gender: v.gender, grade: v.grade, ...('style' in v ? { style: v.style } : {}), speaks: ['en'] as const })),
  ...PHONON_HERITAGE_VOICES.map((v) => ({ id: `phonon:${v.key}`, name: v.name, engine: 'Phonon' as const, accent: v.accent, gender: v.gender, heritage: v.heritage, speaks: ['en'] as const })),
  ...KOKORO_HERITAGE_VOICES.map((v) => {
    const own = KOKORO_OWN_LANGUAGE[v.id[0]!];
    return { id: v.id, name: v.name, engine: 'Kokoro' as const, accent: v.accent, gender: v.gender, heritage: v.heritage, ...('grade' in v ? { grade: v.grade } : {}), speaks: own ? (['en', own] as const) : (['en'] as const) };
  }),
  ...KOKORO_NATIVE_VOICES.map((v) => ({ id: v.id, name: v.name, engine: 'Kokoro' as const, accent: 'US' as const, gender: v.gender, ...('grade' in v ? { grade: v.grade } : {}), speaks: [v.speaks] as const })),
];

/** Whether a voice can speak a podcast in `language`. */
export function speaksLanguage(voice: string, language: string): boolean {
  return !!voiceInfo(voice)?.speaks.includes(languageInfo(language).code);
}

/** The voices listeners and casting may use: the administrator's list, without accent voices while those are switched off. */
export function usableVoices(settings: Pick<AppSettings, 'voices' | 'features'>): string[] {
  return settings.features.accentVoices ? settings.voices.available : settings.voices.available.filter((id) => !voiceInfo(id)?.heritage);
}

export function voiceInfo(voice: string): VoiceInfo | undefined {
  return VOICE_CATALOG.find((v) => v.id === voice);
}

/** Where a voice's short sample lives in storage (rendered by the worker), and the list of those rendered. */
export const VOICE_SAMPLE_PREFIX = 'voice-samples/v1';
export const VOICE_SAMPLE_MANIFEST_KEY = `${VOICE_SAMPLE_PREFIX}/manifest.json`;
/** A voice's sample in a language: English samples keep their original place; other languages have their own folder. */
export function voiceSampleKey(voice: string, language = 'en'): string {
  const file = `${voice.replace(/[^a-zA-Z0-9_-]/g, '-')}.mp3`;
  return language === 'en' ? `${VOICE_SAMPLE_PREFIX}/${file}` : `${VOICE_SAMPLE_PREFIX}/${language}/${file}`;
}
/** How a sample is listed in the manifest: the voice id, prefixed with the language when it isn't English. */
export function voiceSampleEntry(voice: string, language = 'en'): string {
  return language === 'en' ? voice : `${language}:${voice}`;
}
/** What each voice says in its sample, in the sample's language. */
export function voiceSampleText(name: string, language = 'en'): string {
  return (SAMPLE_LINES[languageInfo(language).code] ?? SAMPLE_LINES.en)(name);
}

/** A readable label for a stored voice id, e.g. "Zoey (Phonon, US female)" or "Regina (Phonon, US Latino female)". */
export function voiceLabel(voice: string): string {
  const v = voiceInfo(voice);
  return v ? `${v.name} (${v.engine}, ${v.accent}${v.heritage ? ` ${HERITAGE_LABEL[v.heritage]}` : ''} ${v.gender})` : `${voice} (Kokoro)`;
}

/** The voices offered before the full Kokoro set was added; a stored list equal to this is upgraded. */
const LEGACY_AVAILABLE_VOICES = [
  ...PHONON_VOICES.map((v) => `phonon:${v.key}`),
  ...['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'],
];

/** Every voice before the accent voices were added; a stored list equal to this gains them. */
const CATALOG_BEFORE_ACCENTS = [...PHONON_VOICES.map((v) => `phonon:${v.key}`), ...KOKORO_VOICE_INFO.map((v) => v.id)];
/** Every voice before the voices for other languages were added. */
const CATALOG_BEFORE_LANGUAGES = [...CATALOG_BEFORE_ACCENTS, ...PHONON_HERITAGE_VOICES.map((v) => `phonon:${v.key}`), ...KOKORO_HERITAGE_VOICES.map((v) => v.id)];

/**
 * Brings a stored settings document up to date: a voice list that still matches an earlier default gains the
 * voices added since. A list an administrator changed is left alone.
 */
export function upgradeAppSettings(settings: AppSettings): AppSettings {
  const a = settings.voices.available;
  const matches = (list: readonly string[]) => a.length === list.length && list.every((v) => a.includes(v));
  if (matches(LEGACY_AVAILABLE_VOICES) || matches(CATALOG_BEFORE_ACCENTS) || matches(CATALOG_BEFORE_LANGUAGES)) {
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
    maxRegenerations: 2,
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
  appearance: {
    splashSeconds: DEFAULT_SPLASH_SECONDS,
  },
  features: DEFAULT_FEATURES,
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
    appearance: { ...current.appearance, ...patch.appearance },
    features: { ...current.features, ...patch.features },
    bugReports: { ...current.bugReports, ...patch.bugReports },
  };
  return appSettingsSchema.parse(merged);
}
