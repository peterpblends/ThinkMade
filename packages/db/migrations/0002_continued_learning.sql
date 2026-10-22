ALTER TABLE "learning_request" ADD COLUMN "parent_series_id" text;--> statement-breakpoint
ALTER TABLE "learning_request" ADD COLUMN "update_mode" boolean DEFAULT false NOT NULL;