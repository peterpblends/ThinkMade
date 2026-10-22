CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_config" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_config_stage_unique" UNIQUE("stage")
);
--> statement-breakpoint
CREATE TABLE "app_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"user_template" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"open_library_id" text,
	"wikidata_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"isbn13" text,
	"open_library_id" text,
	"google_books_id" text,
	"first_publish_year" integer,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"verified_via" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_author" (
	"book_id" text NOT NULL,
	"author_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode" (
	"id" text PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"learning_objective" text,
	"primary_mental_model_id" text,
	"speaker_format" text DEFAULT 'single' NOT NULL,
	"planned_minutes" integer,
	"duration_seconds" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcomes" jsonb,
	"key_takeaways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script" jsonb,
	"transcript" text,
	"audio_key" text,
	"audio_bytes" integer,
	"cover_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_mental_model" (
	"episode_id" text NOT NULL,
	"mental_model_id" text NOT NULL,
	"role" text DEFAULT 'supporting' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_quality_check" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"revision" integer NOT NULL,
	"passed" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_by" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_source" (
	"episode_id" text NOT NULL,
	"source_id" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "learning_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"input_text" text,
	"input_transcript" text,
	"media_upload_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objective" text,
	"understanding" jsonb,
	"learning_mode" text DEFAULT 'explore' NOT NULL,
	"customization" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_request_id" text,
	"coaching_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mental_model" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"category" text,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mental_model_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mental_model_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"from_model_id" text NOT NULL,
	"to_model_id" text NOT NULL,
	"relation" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "podcast_series" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"learning_request_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_key" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"public_slug" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_series_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"book_id" text,
	"publisher" text,
	"year" integer,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"verified_via" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_message" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"audio_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_manifest" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"episode_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"series_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playback_state" (
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"manual_status" boolean DEFAULT false NOT NULL,
	"device_id" text,
	"client_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating" (
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"stars" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"client_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_report" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"description" text NOT NULL,
	"screenshot_key" text,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"learning_request_id" text NOT NULL,
	"series_id" text,
	"queue_job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_stage" text,
	"error" text,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"audio_seconds_generated" real DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"stage" text NOT NULL,
	"episode_number" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"analysis" jsonb,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_upload_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"metric" text NOT NULL,
	"provider" text,
	"value" real NOT NULL,
	"user_id" text,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_config" ADD CONSTRAINT "ai_model_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_author" ADD CONSTRAINT "book_author_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_author" ADD CONSTRAINT "book_author_author_id_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."author"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_series_id_podcast_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."podcast_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_primary_mental_model_id_mental_model_id_fk" FOREIGN KEY ("primary_mental_model_id") REFERENCES "public"."mental_model"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_mental_model" ADD CONSTRAINT "episode_mental_model_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_mental_model" ADD CONSTRAINT "episode_mental_model_mental_model_id_mental_model_id_fk" FOREIGN KEY ("mental_model_id") REFERENCES "public"."mental_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_quality_check" ADD CONSTRAINT "episode_quality_check_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_source" ADD CONSTRAINT "episode_source_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_source" ADD CONSTRAINT "episode_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_request" ADD CONSTRAINT "learning_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mental_model_relation" ADD CONSTRAINT "mental_model_relation_from_model_id_mental_model_id_fk" FOREIGN KEY ("from_model_id") REFERENCES "public"."mental_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mental_model_relation" ADD CONSTRAINT "mental_model_relation_to_model_id_mental_model_id_fk" FOREIGN KEY ("to_model_id") REFERENCES "public"."mental_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_series" ADD CONSTRAINT "podcast_series_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_series" ADD CONSTRAINT "podcast_series_learning_request_id_learning_request_id_fk" FOREIGN KEY ("learning_request_id") REFERENCES "public"."learning_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_message" ADD CONSTRAINT "coaching_message_session_id_coaching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."coaching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_session" ADD CONSTRAINT "coaching_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_session" ADD CONSTRAINT "coaching_session_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_manifest" ADD CONSTRAINT "download_manifest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_item" ADD CONSTRAINT "library_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_item" ADD CONSTRAINT "library_item_series_id_podcast_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."podcast_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_state" ADD CONSTRAINT "playback_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_state" ADD CONSTRAINT "playback_state_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating" ADD CONSTRAINT "rating_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_event" ADD CONSTRAINT "sync_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report" ADD CONSTRAINT "bug_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_learning_request_id_learning_request_id_fk" FOREIGN KEY ("learning_request_id") REFERENCES "public"."learning_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_series_id_podcast_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."podcast_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_stage" ADD CONSTRAINT "generation_stage_job_id_generation_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_metric" ADD CONSTRAINT "usage_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "app_setting_name_version_uq" ON "app_setting" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "app_setting_one_active_uq" ON "app_setting" USING btree ("name") WHERE "app_setting"."active" = true;--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_stage_version_uq" ON "prompt_version" USING btree ("stage","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_one_active_uq" ON "prompt_version" USING btree ("stage") WHERE "prompt_version"."active" = true;--> statement-breakpoint
CREATE INDEX "book_title_idx" ON "book" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX "book_author_uq" ON "book_author" USING btree ("book_id","author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_series_number_uq" ON "episode" USING btree ("series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_mental_model_uq" ON "episode_mental_model" USING btree ("episode_id","mental_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_quality_check_uq" ON "episode_quality_check" USING btree ("episode_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_source_uq" ON "episode_source" USING btree ("episode_id","source_id");--> statement-breakpoint
CREATE INDEX "learning_request_user_idx" ON "learning_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mental_model_embedding_idx" ON "mental_model" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "mental_model_relation_uq" ON "mental_model_relation" USING btree ("from_model_id","to_model_id","relation");--> statement-breakpoint
CREATE INDEX "podcast_series_user_idx" ON "podcast_series" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "podcast_series_visibility_idx" ON "podcast_series" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "podcast_series_embedding_idx" ON "podcast_series" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "coaching_message_session_idx" ON "coaching_message" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "coaching_session_user_idx" ON "coaching_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "download_manifest_uq" ON "download_manifest" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_uq" ON "favorite" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_item_uq" ON "library_item" USING btree ("user_id","series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playback_state_uq" ON "playback_state" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_uq" ON "rating" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_event_uq" ON "sync_event" USING btree ("user_id","device_id","sequence");--> statement-breakpoint
CREATE INDEX "bug_report_status_idx" ON "bug_report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_job_user_idx" ON "generation_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_job_status_idx" ON "generation_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_stage_job_idx" ON "generation_stage" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "media_upload_user_idx" ON "media_upload" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_metric_metric_idx" ON "usage_metric" USING btree ("metric","created_at");