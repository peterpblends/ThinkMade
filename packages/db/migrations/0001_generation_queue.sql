ALTER TABLE "episode" ADD COLUMN "hosts" jsonb;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "run_after" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_job" ADD COLUMN "cancel_requested" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "generation_job_claim_idx" ON "generation_job" USING btree ("status","run_after");