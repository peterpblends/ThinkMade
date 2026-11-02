CREATE TABLE "episode_translation" (
	"episode_id" text NOT NULL,
	"language" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"learning_objective" text,
	"outcomes" jsonb,
	"key_takeaways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script" jsonb,
	"transcript" text,
	"hosts" jsonb,
	"audio_key" text,
	"audio_bytes" integer,
	"duration_seconds" real,
	"status" text DEFAULT 'voicing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_translation_episode_id_language_pk" PRIMARY KEY("episode_id","language")
);
--> statement-breakpoint
CREATE TABLE "series_translation" (
	"series_id" text NOT NULL,
	"language" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_translation_series_id_language_pk" PRIMARY KEY("series_id","language")
);
--> statement-breakpoint
ALTER TABLE "podcast_series" ADD COLUMN "original_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "podcast_series" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_translation" ADD CONSTRAINT "episode_translation_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_translation" ADD CONSTRAINT "series_translation_series_id_podcast_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."podcast_series"("id") ON DELETE cascade ON UPDATE no action;