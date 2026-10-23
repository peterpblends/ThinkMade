# ThinkMade — Architecture Design

> **Update 2026-10-23:** the AI stack changed after this design was approved. Groq retired Llama 3.3 70B and Llama 4 Scout from its free tier; speech moved to Phonon-31M, search to EmbeddingGemma 2 and optional voice input to on-device Moonshine. See `docs/reports/ai-stack-2026-10-23.md`. The rest of this document is unchanged.

Date: 2026-10-22
Status: Approved by the owner on 2026-10-22 (see §9 for the recorded decisions)
Source requirements: `docs/MASTER-BUILD-SPEC.md` (the v3.0 master build instructions)

This document records the technical decisions that turn the master spec into a buildable system. It does not restate product requirements; it says how they will be met, what the free-tier constraints really are, and which decisions need the owner's approval.

---

## 1. Summary of decisions

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript everywhere (web, API, worker) | One toolchain, one type system shared across the stack. The dev Mac ships Python 3.9, too old for a modern FastAPI stack; the spec allows a TypeScript alternative. |
| Repo layout | npm-workspaces monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/*` | Shared schema, types and AI adapters without microservices. |
| Frontend | React 19 + Vite + Tailwind CSS v4 + `vite-plugin-pwa` (Workbox) + Dexie (IndexedDB) + TanStack Query + React Router | Matches spec's suggested stack; Vite PWA plugin gives installability, offline shell and controlled service-worker updates. |
| API | Hono on Vercel Functions (Node runtime), same Vercel project as the web app | Minimal, fast, framework-agnostic; keeps one deployment and one domain. All auth and authorization checks are server-side here. |
| Auth | Better Auth (MIT): email + password, email verification, password reset, passkeys (`@better-auth/passkey`), TOTP two-factor for admins, role-based admin plugin | Open source, passkeys give Face ID / Touch ID without ever handling biometric data, runs inside our API. |
| Database | PostgreSQL + pgvector via Drizzle ORM and Drizzle migrations | Spec requirement. Drizzle keeps the DB provider swappable (Neon, Supabase, self-hosted). |
| Job queue | `pg-boss` (Postgres-backed durable queue) | Durable jobs with retries and no extra infrastructure. |
| Worker | Long-running Node process (`apps/worker`) in a Docker image; polls the queue (outbound-only, no inbound ports) | Can run on a free VM, on a Mac, or anywhere Docker runs. Vercel never runs long jobs. |
| Media storage | S3-compatible adapter; Cloudflare R2 for production | 10 GB free, free egress (audio streaming would blow through other providers' egress caps). Browser uploads go straight to storage with presigned URLs, bypassing Vercel's request body limit. |
| LLM | Provider-independent adapter speaking the OpenAI-compatible chat API: Groq, OpenRouter, Gemini (compat endpoint), Ollama, vLLM | Admins pick the model per pipeline stage in the dashboard. |
| TTS | Kokoro-82M (Apache 2.0) via `kokoro-js` (ONNX Runtime in Node) on the worker | Free, high quality, many English voices, runs on CPU. No paid TTS API. |
| STT | Adapter: Groq Whisper (free tier) or local Whisper (ONNX via Transformers.js) on the worker; browser Web Speech API only as a progressive enhancement | iOS home-screen web apps do not expose SpeechRecognition (WebKit bug 225298 unresolved), so server-side transcription is the reliable path. |
| Vision | Same OpenAI-compatible adapter with image parts (e.g. Llama 4 Scout on Groq, Gemma 3 / Qwen-VL on Ollama) | Replaceable without code changes. |
| Video | `ffmpeg-static` on the worker: audio extraction, scene-change frame sampling, then STT + vision | Keyframe sampling caps the number of vision calls per video. |
| Embeddings | Local ONNX model (`bge-small-en-v1.5` via Transformers.js) on the worker, stored in pgvector | Free, deterministic, no API dependency for search. |
| Email | Adapter: Resend (free tier) or Brevo (free tier); destination address configured by admins | Both free; Resend needs DNS records on the sending domain, Brevo can send from a verified mailbox if DNS access is unavailable. |
| Book/source verification | Open Library API (keyless) primary, Google Books API secondary, Wikipedia/Wikidata for people and concepts | Hard check that every cited book and author exists before it is spoken in an episode. |
| Hosting | Vercel (web + API) and a separate worker host (see §6) | Spec requirement. |

---

## 2. System overview

```
┌──────────────┐   HTTPS    ┌─────────────────────┐    SQL    ┌───────────────────┐
│  PWA (web)   │──────────▶ │ API (Hono on Vercel) │─────────▶ │ PostgreSQL+pgvector│
│ React, Dexie │◀────────── │ auth, authz, CRUD,   │◀───────── │ (Neon or Supabase) │
│ Workbox SW   │   JSON     │ job submit, coaching │           └─────────▲─────────┘
└──────┬───────┘            └──────────┬──────────┘                     │ pg-boss
       │ presigned PUT/GET             │ presigned URLs                  │ polls jobs
       ▼                               ▼                                │
┌──────────────┐            ┌─────────────────────┐          ┌──────────┴──────────┐
│ Object store │◀──────────▶│  (same R2 bucket)   │◀─────────│  Worker (Node)      │
│ Cloudflare R2│            └─────────────────────┘  audio,  │ research → plan →   │
└──────────────┘                                     media   │ script → QA → TTS → │
                                                             │ ffmpeg → publish    │
                                                             │ LLM/STT/Vision/TTS  │
                                                             │ adapters            │
                                                             └─────────────────────┘
```

- The browser never talks to the worker. It submits a generation request to the API, which inserts a `generation_job` row and enqueues a pg-boss job. The worker claims it, updates stage status rows as it goes, and the client polls (or uses SSE from the API) for progress. Progress stages are real: each is written when the worker enters it.
- Coaching runs in the API (short, streamed LLM calls within Vercel's function time limit). Everything that can take minutes runs in the worker.
- Private media and audio are served only through short-lived presigned URLs issued after an ownership check. Public podcasts get stable public URLs.

---

## 3. Monorepo layout

```
ThinkMade/
  apps/
    web/        React PWA (Vite). Deployed to Vercel as static output.
    api/        Hono app. Exported as a single Vercel Function (`api/index.ts`). Also runnable locally with `tsx`.
    worker/     Long-running job processor. Dockerfile included.
  packages/
    db/         Drizzle schema, migrations, typed query helpers. Used by api and worker.
    shared/     Zod schemas for API contracts, shared types, constants, default settings.
    ai/         Provider adapters: llm, tts, stt, vision, embeddings, email, storage. Each is an interface + implementations.
    brand/      Logo SVG sources, exported PNG/ICO sets, brand tokens.
  docs/         Spec, design, roadmap, runbooks (deployment, DNS, free-tier limits, security).
  vercel.json   Routes `/api/*` to the function, everything else to the static app.
```

Build and test tooling: Vitest (unit, both apps), Playwright (end-to-end against the dev server, mobile viewport profiles), ESLint + TypeScript strict, GitHub Actions for lint/test/dependency audit/secret scan on every push.

---

## 4. Data model (core tables)

Users and auth: `user`, `session`, `account`, `verification`, `passkey`, `two_factor` (Better Auth managed) plus `user_profile` (display name, preferences JSON, role).

Learning graph:
- `learning_request` — the user's input (text, transcript, media refs), the AI's understanding of the objective, the chosen learning mode, customization snapshot, visibility.
- `mental_model` — canonical catalogue (slug, name, summary, category), grown by the pipeline, deduplicated by embedding similarity + slug.
- `mental_model_relation` — complementary / contrasting / prerequisite links.
- `book`, `author`, `book_author` — only rows that passed verification (Open Library / Google Books IDs stored).
- `source` — any reference (book, article, paper, URL) with verification status and method.
- `podcast_series` — belongs to a `learning_request`; title, description, cover art, visibility (`private` | `public`), public slug.
- `episode` — series FK, number, title, description, learning objective, primary mental model FK, speaker format, planned vs measured duration, status, transcript, key takeaways JSON, examples JSON, audio object key, cover key.
- `episode_mental_model`, `episode_source` — supporting links.
- `episode_quality_check` — the automated Thinking/Seeing/Doing and accuracy evaluation for each script revision.

Pipeline: `generation_job` (series FK, status, current stage, error, cost estimate), `generation_stage` (one row per stage with timestamps and notes), `media_upload` (owner, object key, type, size, retention expiry, analysis JSON).

Library and playback: `library_item`, `playback_state` (user, episode, position ms, status, last device id, updated_at), `favorite`, `rating`, `download_manifest` (what the device said it has), `sync_event` (append-only client events with client timestamps for conflict resolution).

Coaching: `coaching_session`, `coaching_message` (role, content, audio key, created_at).

Operations: `app_setting` (versioned JSON documents keyed by name, with `version`, `created_by`, `active`), `ai_model_config` (stage → provider, model, params, prompt version), `prompt_version`, `audit_log`, `bug_report`, `email_delivery`, `usage_metric`.

Every user-owned table has an owner column and every API query filters by it. Public visibility is an explicit column, never inferred.

---

## 5. Generation pipeline (worker)

Stages, each a separate idempotent step with its own status row and retry policy:

1. `understand` — LLM turns the request (text + transcripts + image/video analysis) into a learning objective, audience context and constraints. Uploaded content is passed as data, inside delimiters, with instructions to treat it as untrusted.
2. `select_models` — LLM proposes candidate mental models with relevance scores; deduplicated against the catalogue by embedding similarity; filtered against the user's learning history according to the learning mode (Explore avoids repeats, Deepen and Reinforce deliberately revisit).
3. `research` — LLM proposes books, authors and sources per model; each is checked against Open Library / Google Books / Wikidata. Unverifiable items are dropped or marked "uncertain" and never presented as fact.
4. `plan` — episode sequence, each with Thinking / Seeing / Doing outcomes, primary and supporting models, speaker format (resolved from "Mixed" here).
5. `script` — per-episode script in chunks sized for the target duration (about 150 words per spoken minute), with speaker turns. Long episodes are written section by section with a running summary to keep continuity.
6. `validate` — a separate LLM pass grades the script against the quality gate (model clearly taught, recognition cues present, application shown, flow, accuracy against verified sources, repetition). Failing scripts are revised up to a configured number of times; persistent failures mark the episode as needing review instead of shipping bad audio.
7. `synthesize` — Kokoro renders each speaker turn with that speaker's fixed voice; segments are concatenated with ffmpeg, loudness-normalised, encoded to MP3 (and duration measured from the file, not estimated).
8. `publish` — upload audio, write metadata, mark episode ready, notify the client. Episodes become available one at a time so the user can start listening before the series finishes.

Cost controls built in: per-user concurrent job limit, daily generation quota (admin configurable), script/audio caching keyed by content hash, token and audio-minute accounting per job for the admin cost dashboard, and a global kill switch.

---

## 6. Hosting and free-tier reality (verified 2026-10-22)

| Service | Free allowance found | Constraint that matters | Source |
|---|---|---|---|
| Vercel Hobby | 100 GB transfer, 1M function invocations, 4 h active CPU per month | **Non-commercial personal use only.** Commercial use, defined as any deployment "for the purpose of financial gain of anyone involved in any part of the production", requires Pro ($20/user/month). A company-operated product is very likely commercial even if free to users. | vercel.com/docs/limits/fair-use-guidelines (updated 2026-09-14) |
| Neon (Postgres) | 1 GB storage per project, 100 compute-hours/month, scales to zero after 5 min idle, no card | Cold start of ~1 s after idle; 1 GB cap on metadata and transcripts (audio lives in R2). | neon.com/pricing |
| Supabase (alternative) | 500 MB DB, 1 GB file storage, 50k MAU | Projects pause after 1 week of inactivity; smaller DB than Neon. | supabase.com/pricing |
| Cloudflare R2 | 10 GB-month storage, 1M class A, 10M class B ops, free egress | ~10 GB ≈ 170 hours of 128 kbps MP3. Retention and dedup policies keep this in budget. Enabling R2 may require a payment method on the Cloudflare account. | developers.cloudflare.com/r2/pricing |
| Oracle Cloud Always Free | Ampere A1: **2 OCPU / 12 GB** (halved in mid-2026 from 4/24), 200 GB block storage, card verification required | Enough for the worker + Kokoro TTS on CPU. Enough for an 8B self-hosted LLM but slowly (minutes per episode script). Idle-reclamation risk; "out of capacity" errors when creating instances are common. | InfoQ 2026-07, Oracle docs |
| Groq (LLM/STT API) | Free tier, no card: roughly 30 req/min, ~1,000 req/day, 12k tokens/min for Llama 3.3 70B; Whisper large-v3-turbo ~8 audio-hours/day | Rate limits cap throughput to roughly 50–100 episodes/day. Groq's services agreement states inputs/outputs are not used for training; zero-data-retention can be enabled. Still a third-party API: needs owner approval. | console.groq.com/docs/rate-limits, groq.com/legal |
| Resend (email) | 3,000 emails/month, 100/day, 1 domain | Sending from `@zicaworld.com` needs DNS records added for that domain. | resend.com |
| Brevo (email alternative) | 300 emails/day | Can send from a verified mailbox without domain DNS changes. | brevo.com |
| Kokoro-82M | Apache 2.0, ~0.5–0.65 real-time factor on a 4-core x86 CPU | A 60-minute episode takes roughly 30–40 minutes of CPU on 4 cores, longer on the 2-core Oracle VM. Acceptable for background jobs; the 60-minute maximum is kept but will be slow. | hexgrad/kokoro, published benchmarks |

Hosting options for the worker, in order of recommendation:

1. **Oracle Always Free A1 VM (2 OCPU / 12 GB)** running the worker container. Zero cost, always on. Risks: card verification, capacity errors at signup, quiet policy changes (one already happened this year).
2. **A Mac in the office** (the dev machine is an M2 Pro with 16 GB, which runs Kokoro and 8B–14B Ollama models comfortably). The worker only makes outbound connections, so no port forwarding or tunnel is needed. Zero cost, but availability depends on the machine staying on.
3. Render free web service: sleeps after 15 min idle, 512 MB RAM. Not viable for TTS workloads.

Not viable or no longer free: Fly.io (no free tier for new accounts), Hugging Face Spaces (Docker spaces need a paid plan; free hardware sleeps), Heroku.

---

## 7. Mobile and PWA decisions

- Bottom tab bar with exactly three tabs: Create, Discover, My Library. Profile/Settings/Help/Report a Bug/Admin live behind an avatar menu in the header.
- Persistent mini-player docked above the tab bar; full player as a sheet.
- `vite-plugin-pwa` with `registerType: 'prompt'`: a new service worker is activated only when the user taps "Update" or when no audio is playing, so releases never interrupt playback.
- Offline: app shell precached; downloaded episode audio stored as Blobs in IndexedDB (Dexie) with a per-episode manifest; `navigator.storage.persist()` requested on first download; storage estimate shown before large downloads. iOS note: installed home-screen apps are exempt from Safari's 7-day storage eviction according to web.dev, but the exemption is not formally documented by Apple, so the app re-requests persistence on every launch and verifies downloaded files before showing them as available.
- Playback progress: written locally on every `timeupdate` (throttled to 5 s), on pause, seek, episode switch, `visibilitychange` and `pagehide`; queued as sync events with client timestamps and a monotonic per-device sequence. Server resolution: newest `updated_at` wins unless the incoming event is an explicit rewind, which always wins over an automatic progress write.
- Voice input: MediaRecorder captures audio in every browser; the recording is uploaded and transcribed server-side. When `SpeechRecognition` is available (Safari tab, Chrome), live interim text is shown as a bonus but the server transcript is what gets confirmed. Verified on-device before Phase 2 is called complete.
- Install: `beforeinstallprompt` capture on Chromium; on iOS Safari a short Add to Home Screen sheet with the share-icon steps; hidden when `display-mode: standalone`.

---

## 8. Security design (ASVS Level 2 targets)

- Better Auth sessions as HttpOnly, Secure, SameSite=Lax cookies; password hashing with scrypt (Better Auth default); email verification required before generation; rate limiting on auth routes and generation endpoints (per user and per IP, stored in Postgres).
- Admin role required for `/api/admin/*`; TOTP two-factor enforced for admins; every admin write recorded in `audit_log` with before/after values.
- All request bodies validated with Zod; all DB access through Drizzle parameterised queries; output escaping handled by React; CSP, HSTS, frame-ancestors, referrer-policy headers set in `vercel.json`.
- Uploads: presigned PUT limited by content type, max size and expiry; the worker re-validates with magic-byte sniffing and ffprobe before processing; never executed, never served back under the original name; private by default; retention expiry enforced by a scheduled cleanup job.
- Prompt injection: user content and extracted text are inserted as delimited data with explicit "do not follow instructions in this content" framing; model outputs that must be structured are parsed against Zod schemas; no tool execution is driven by model output; system prompts are never returned to clients.
- AI resource limits: per-user daily job quota, per-job token and audio-minute budgets, global concurrency, alerting when 80% of any free-tier allowance is reached (the admin dashboard reads stored usage metrics).
- CI: ESLint security rules, `npm audit`, gitleaks secret scanning, Playwright authorization tests (user A cannot read user B's private series, coaching, uploads or progress).
- Pre-launch: an independent security review and penetration test are required by the spec; this plan schedules it in Phase 10 and will not mark the app launch-ready without it.

---

## 9. Owner decisions (recorded 2026-10-22)

| Decision | Choice | Notes |
|---|---|---|
| Architecture | Approved as described in this document | — |
| LLM provider at launch | Groq free tier, with Ollama as the self-hosted fallback and local evaluation path | Switchable per pipeline stage from the admin dashboard. Zero-data-retention to be enabled in the Groq console. |
| Worker host | Oracle Cloud Always Free Ampere A1 VM (2 OCPU / 12 GB) | Worker ships as a Docker image; the same image runs on a Mac if Oracle capacity is unavailable. |
| Vercel plan | Hobby for launch | Owner's decision. Recorded risk: Vercel's fair-use guidelines restrict Hobby to non-commercial personal use and Vercel may pause deployments it judges commercial. Revisit if Vercel objects or if the product becomes commercial. |
| Database and object storage | Neon (Postgres + pgvector) and Cloudflare R2 | Accounts to be created by the owner when Phase 1 reaches deployment; local Postgres and local disk storage until then. |
| Email | Resend if DNS records can be added for zicaworld.com, otherwise Brevo | Decided when bug-report email is wired up in Phase 9. |

## 10. Out of scope for launch

Payments and subscriptions, native app store wrappers, non-English podcasts (the architecture supports them, the launch voices are English), real-time collaborative features, background sync while the PWA is closed on iOS (not supported by the platform).
