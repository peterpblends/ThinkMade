# Phase 4 report: photo and video

**Status: complete.** It is tested with real generated images and videos and a stand-in vision model. A real vision model has not been run, because no vision-capable provider is configured on this Mac.

## Completed

- **Uploads.** Files are checked by their actual bytes (JPEG, PNG, WebP, HEIC, MP4, MOV, WebM), never by the declared type. Admin limits apply to count and size. Files are stored privately under `uploads/<user>/` with a retention date (default 30 days). Large files go straight to R2 through presigned PUT URLs, because Vercel caps request bodies at 4.5 MB.
- **Worker processing.** The worker checks content again before reading anything:
  - **Photos** are re-encoded and downscaled, which also strips GPS and other metadata, then described by the vision model.
  - **Videos** are probed for length, their soundtrack is transcribed, and up to 6 key frames are chosen by scene change (or spaced evenly), all sent in one vision request.
- **Evidence and assumptions.** The analysis keeps visible evidence separate from assumptions, and feeds the understanding stage.
- **Privacy.** Uploads are never shown on public pages. They are deleted automatically after the retention date. Deleting an account removes the user's stored uploads and audio.
- **Create screen.** It has camera, library and video pickers with previews, remove buttons and limit checks. A photo alone is enough to create a podcast.

## Tests

Unit tests run against real generated media, plus API tests for upload rules and worker tests for analysis, rejection and retention. End-to-end tests cover a photo producing a podcast and a disguised file being refused.

## Notes

ffmpeg 6 (from ffmpeg-static) may not decode every HEIC variant. Such photos are rejected with a plain message. iOS Safari usually converts photos to JPEG when uploading.
