CREATE TABLE "terms_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" text NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terms_acceptance_user_idx" ON "terms_acceptance" USING btree ("user_id","version");