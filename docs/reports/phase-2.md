# Phase 2 report: core podcast generation

**Status: works end to end.** It was verified with test providers in automated tests, and with a real open model (qwen2.5 7B through Ollama), real Kokoro voices and live Open Library verification on this Mac. It has not been run with Groq, because there is no API key on this machine.

## Completed

- **Provider adapters** in `packages/ai`:
  - language models through any OpenAI-compatible API (Groq, OpenRouter, Ollama, Gemini), with JSON validation and self-correcting retries
  - Kokoro text-to-speech, plus a test voice
  - Whisper speech-to-text through Groq
  - local disk or S3/R2 storage, with presigned URLs
  - ffmpeg assembly with loudness normalisation and duration measured from the finished file
- **Durable job queue** on the `generation_job` table. It uses row locks, leases, retries with backoff and resumable state. A crashed or stalled worker's job is reclaimed when its lease expires. Since the final review, the old worker is fenced: it checks it still holds the lease before each stage and before writing results, so it can never overwrite the new owner's work. Retries after rate limits are capped, then the job fails with a clear message.
- **The pipeline:** understand, select models, research and verify books, plan, write the script section by section, check, synthesise and publish. Mixed format alternates two hosts and one host. Explore excludes models the user has already covered.
- **API.** Creating a job applies admin defaults, customisation within admin limits and a daily quota. It also covers progress from real stages, cancellation, series and episode details, and audio with HTTP Range support. Every one of these checks ownership.
- **Voice input.** The browser records with MediaRecorder and the server transcribes, with an editable result. Browsers with the Web Speech API fall back to it.
- **Screens.** Create submits for real, a live progress screen shows the four real steps, and series pages play the audio.

## Tests

- Unit and integration tests cover the adapters, queue, pipeline, routes and privacy rules. Five worker tests were written after the code, which breaks test-first order. They were checked by mutation instead: breaking book verification or the Explore filter makes them fail.
- End-to-end: topic in, playable MP3 out, on iPhone, Pixel and desktop profiles.
- Live runs with a real model surfaced and fixed three real bugs:
  - research replies renaming model slugs
  - book titles with subtitles and co-authors failing verification
  - small models writing scripts too short

## Known limits

- **Groq free tier.** About 1,000 requests and roughly 100k–200k tokens a day on 70B-class models. That allows only a handful of series a day. See `free-tier-limits.md`.
- **Speech speed.** Kokoro runs at about 0.5× real time on an M2 Pro, and slower on the 2-core ARM VM.
