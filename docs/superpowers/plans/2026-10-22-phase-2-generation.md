# Phase 2 — Core Podcast Generation Plan

**Goal:** A verified user types (or speaks) a topic, taps Create My Podcasts, watches real progress stages, and gets a series of real, playable MP3 episodes. Each episode has a title, a primary mental model, verified books, outcomes and a transcript.

**Spec:** `docs/MASTER-BUILD-SPEC.md` §§6, 7.1–7.2, 11, 12 and the architecture design §5.

## Decisions (owner approved the architecture; these refine it)

- **Queue.** I use our own durable queue on the `generation_job` table, not pg-boss. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, take a lease with `locked_until`, retry with backoff, and stop at a maximum attempt count. Why: pg-boss needs a network Postgres, and local development runs on embedded PGlite. One table also keeps job status and progress in one place.
- **Worker placement.** `apps/worker` exports `startWorker()`. In production it runs as its own process (the Oracle VM) against `DATABASE_URL`. Locally, with no `DATABASE_URL`, the API process starts it in-process, because PGlite is single-process.
- **Providers.** All providers live in `packages/ai`:
  - `llm`: an OpenAI-compatible chat client covering Groq, OpenRouter, Ollama and Gemini's OpenAI endpoint, plus `fake` for tests.
  - `tts`: Kokoro through kokoro-js on CPU, plus `tone` for tests. `tone` writes real audio of the right length.
  - `stt`: OpenAI-compatible transcription covering Groq Whisper, plus `fake`.
  - `storage`: local disk or any S3-compatible store such as R2.
  - `books`: Open Library first, then Google Books.
  - `audio`: ffmpeg concatenation, loudness normalisation, MP3 encoding, and duration measured from the finished file.
- **Stage models.** The `ai_model_config` table chooses the model per stage. Defaults are seeded to Groq `llama-3.3-70b-versatile`. A missing API key fails the job with an honest message.
- **Structured output.** Every LLM stage asks for JSON and validates it with Zod. On a validation error it re-prompts with the error, up to two times.
- **Script length.** Scripts target about 150 spoken words per minute. Episodes over 10 minutes are written section by section, with a running summary between sections, so 60-minute episodes don't depend on one huge completion.
- **Book verification.** A book survives only if Open Library or Google Books returns a matching title and author. Unverified books are dropped and never spoken.
- **Explore mode.** Explore excludes mental models the user has already covered. Deepen and Reinforce are handled in Phase 8.
- **Progress.** Labels map to real stages:
  - `understand` → "Understanding your topic"
  - `select_models` and `research` → "Connecting relevant thinking"
  - `plan` and `script` → "Building your podcasts"
  - `synthesize` → "Preparing the audio"
  - finished → "Ready to listen"
- **Voice input.** MediaRecorder audio goes to `POST /api/transcribe`, which calls the STT provider. The result is an editable transcript. Browsers with the Web Speech API also show live text. If no STT provider is configured, the endpoint returns an honest 503.
- **Audio delivery.** `GET /api/episodes/:id/audio` checks that the caller owns the episode. It then redirects to a short-lived presigned URL (S3/R2) or streams from local disk with HTTP Range support, so seeking works in Safari.
- **Quotas.** `perUserDailyJobs` is enforced when a job is created. `generationConcurrency` is enforced when a worker claims a job.

## Tasks

1. `packages/ai`: provider interfaces and implementations, each with tests.
2. Database migration: queue columns on `generation_job`, `ai_model_config` defaults.
3. `apps/worker`: queue, pipeline stages and the job runner, tested end to end with fake LLM, tone TTS and real ffmpeg.
4. API: create and read generations, list and read series, stream episode audio, transcribe voice.
5. Web: submit from Create, voice input, progress screen, series screen with a basic player.
6. A real-audio check of Kokoro on this Mac, and a live LLM check if a provider is reachable.
7. Phase report.
