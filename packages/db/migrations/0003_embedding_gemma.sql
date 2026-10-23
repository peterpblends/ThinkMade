-- Search vectors move from 384 to 512 dimensions (EmbeddingGemma 2, Matryoshka). Old vectors can't
-- be converted, so they are cleared; the worker re-indexes public series in the background.
UPDATE "mental_model" SET "embedding" = NULL;--> statement-breakpoint
UPDATE "podcast_series" SET "embedding" = NULL;--> statement-breakpoint
ALTER TABLE "mental_model" ALTER COLUMN "embedding" SET DATA TYPE vector(512);--> statement-breakpoint
ALTER TABLE "podcast_series" ALTER COLUMN "embedding" SET DATA TYPE vector(512);--> statement-breakpoint
ALTER TABLE "mental_model" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "podcast_series" ADD COLUMN "embedding_model" text;
