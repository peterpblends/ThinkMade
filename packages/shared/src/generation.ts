import { z } from 'zod';
import { learningModeSchema, speakerFormatSchema, visibilitySchema } from './settings.ts';

/** Internal pipeline stages, in order. */
export const GENERATION_STAGES = ['analyze_media', 'understand', 'select_models', 'research', 'plan', 'script', 'validate', 'synthesize', 'publish'] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

/** What the user sees. Each label maps to real stages; nothing is shown that has not happened. */
export const STAGE_LABELS = [
  { label: 'Understanding your topic', stages: ['analyze_media', 'understand'] },
  { label: 'Connecting relevant thinking', stages: ['select_models', 'research'] },
  { label: 'Building your podcasts', stages: ['plan', 'script', 'validate'] },
  { label: 'Preparing the audio', stages: ['synthesize', 'publish'] },
] as const satisfies ReadonlyArray<{ label: string; stages: readonly GenerationStage[] }>;

export const READY_LABEL = 'Ready to listen';

export function labelForStage(stage: string | null | undefined): string {
  return STAGE_LABELS.find((s) => (s.stages as readonly string[]).includes(stage ?? ''))?.label ?? STAGE_LABELS[0].label;
}

export const createGenerationSchema = z.strictObject({
  topic: z.string().trim().max(2000).default(''),
  customization: z
    .strictObject({
      lengthMinutes: z.number().int().min(1).max(60),
      episodes: z.number().int().min(1).max(50),
      speakerFormat: speakerFormatSchema,
      learningMode: learningModeSchema,
    })
    .nullable()
    .default(null),
  visibility: visibilitySchema.optional(),
  mediaUploadIds: z.array(z.string().uuid()).max(10).default([]),
  parentSeriesId: z.string().uuid().optional(),
  /** With parentSeriesId: look for newer verified material on the same topic. */
  update: z.boolean().optional(),
  coachingSessionId: z.string().uuid().optional(),
}).refine((v) => v.topic.length >= 3 || v.mediaUploadIds.length > 0 || !!v.coachingSessionId || !!v.parentSeriesId, {
  path: ['topic'],
  message: 'Tell us a little more about what you want to think through, or add a photo or video.',
});
export type CreateGenerationInput = z.input<typeof createGenerationSchema>;

/** Options resolved at submit time from admin defaults plus the user's customisation. */
export interface GenerationOptions {
  lengthMinutes: number;
  episodes: number;
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  learningMode: 'explore' | 'deepen' | 'reinforce';
  visibility: 'private' | 'public';
  language: string;
  teachingStyle: string;
  voices: { single: string; hostA: string; hostB: string };
  bitrateKbps: number;
  maxTokens: number;
  maxAudioMinutes: number;
  quality?: { minScore: number; maxRevisions: number };
}

export const HOST_NAMES = { A: 'Maya', B: 'Theo' } as const;
