import { z } from 'zod';

const slug = z
  .string()
  .min(2)
  .max(80)
  .transform((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

export const understandingSchema = z.object({
  objective: z.string().min(10).max(600),
  context: z.string().max(1500).default(''),
  audience: z.string().max(300).default(''),
  keyQuestions: z.array(z.string().max(300)).max(8).default([]),
  /** Facts taken directly from what the user said or showed. */
  evidence: z.array(z.string().max(300)).max(12).default([]),
  /** Things inferred but not stated; kept separate so episodes never present them as fact. */
  assumptions: z.array(z.string().max(300)).max(12).default([]),
  seriesTitle: z.string().min(3).max(120),
  seriesDescription: z.string().min(10).max(600),
});
export type Understanding = z.infer<typeof understandingSchema>;

export const modelSelectionSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(2).max(100),
        slug,
        summary: z.string().min(10).max(500),
        category: z.string().max(60).default('general'),
        relevance: z.string().min(5).max(500),
        score: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(20),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const researchSchema = z.object({
  models: z.array(
    z.object({
      slug,
      books: z
        .array(z.object({ title: z.string().min(1).max(200), author: z.string().min(2).max(120), why: z.string().max(400).default('') }))
        .max(6),
      related: z
        .array(z.object({ name: z.string().max(100), relation: z.enum(['complementary', 'contrasting', 'prerequisite', 'related']) }))
        .max(6)
        .default([]),
    }),
  ),
});
export type Research = z.infer<typeof researchSchema>;

export const planSchema = z.object({
  episodes: z
    .array(
      z.object({
        number: z.number().int().min(1),
        title: z.string().min(3).max(120),
        description: z.string().min(10).max(700),
        primaryModelSlug: slug,
        supportingModelSlugs: z.array(slug).max(4).default([]),
        learningObjective: z.string().min(10).max(400),
        outcomes: z.object({
          thinking: z.string().min(10).max(500),
          seeing: z.string().min(10).max(500),
          doing: z.string().min(10).max(500),
        }),
        keyTakeaways: z.array(z.string().min(5).max(300)).min(2).max(6),
        examples: z
          .array(
            z.object({
              title: z.string().max(120),
              kind: z.enum(['real', 'hypothetical']),
              summary: z.string().max(500),
            }),
          )
          .min(1)
          .max(5),
        sections: z.array(z.object({ heading: z.string().max(120), goal: z.string().max(400) })).min(1).max(16),
      }),
    )
    .min(1),
});
export type Plan = z.infer<typeof planSchema>;
export type PlannedEpisode = Plan['episodes'][number];

export const scriptSectionSchema = z.object({
  segments: z
    .array(z.object({ speaker: z.enum(['A', 'B']), text: z.string().min(1).max(4000) }))
    .min(1)
    .max(120),
  summary: z.string().max(800).default(''),
});
export type ScriptSection = z.infer<typeof scriptSectionSchema>;
