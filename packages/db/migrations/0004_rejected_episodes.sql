-- Episodes a reviewer rejected get their own status, so listeners no longer see them. Before this, a
-- rejection left the episode "failed" with a failing human quality check.
UPDATE "episode" SET "status" = 'rejected'
  WHERE "status" = 'failed'
    AND EXISTS (SELECT 1 FROM "episode_quality_check" q WHERE q."episode_id" = "episode"."id" AND q."checked_by" = 'human' AND q."passed" = 0);--> statement-breakpoint
-- A series whose remaining episodes are all ready is complete.
UPDATE "podcast_series" SET "status" = 'ready'
  WHERE "status" IN ('partial', 'failed')
    AND EXISTS (SELECT 1 FROM "episode" e WHERE e."series_id" = "podcast_series"."id" AND e."status" = 'ready')
    AND NOT EXISTS (SELECT 1 FROM "episode" e WHERE e."series_id" = "podcast_series"."id" AND e."status" NOT IN ('ready', 'rejected'));--> statement-breakpoint
UPDATE "generation_job" SET "status" = 'succeeded', "error" = NULL
  WHERE "status" IN ('partial', 'failed')
    AND EXISTS (SELECT 1 FROM "podcast_series" s WHERE s."id" = "generation_job"."series_id" AND s."status" = 'ready');
