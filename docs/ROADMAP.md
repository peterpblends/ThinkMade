# ThinkMade — Implementation Roadmap and Progress Checklist

Tracks the ten phases from the master spec. A box is ticked only when the item is implemented and verified (tests or a real-device check), never when it merely exists as a stub.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified · `[!]` blocked (reason noted)

## Phase 1 — Foundation
- [ ] Monorepo structure (apps/web, apps/api, apps/worker, packages/db, packages/shared, packages/ai, packages/brand)
- [ ] Development environment: local Postgres (pgvector), local object storage, `.env.example`, one-command dev start
- [ ] Design tokens and Tailwind theme (Warm Ivory, Deep Charcoal, Terracotta, Sage Green, Soft White; light and dark)
- [ ] Logo and brand assets (symbol, wordmark, horizontal, stacked, light/dark/mono, SVG + PNG, favicons, Apple touch icon, maskable PWA icons, social image) tested at 32/48/64/128/180/192/512 px
- [ ] Mobile shell: three-tab bottom navigation, header avatar menu, safe-area handling, no horizontal overflow
- [ ] Accounts: register, verify email, sign in, reset password, passkeys, sign out, delete account, export data
- [ ] Database schema and migrations for the core model
- [ ] Admin settings store with versioning and rollback; seeded defaults from the spec
- [ ] Vercel project configuration, custom-domain documentation, DNS record documentation
- [ ] CI: lint, typecheck, unit tests, dependency audit, secret scan
- [ ] Phase report

## Phase 2 — Core Podcast Generation
- [ ] Create screen: "What would you like to think through today?", text input, Create My Podcasts, Customize
- [ ] Voice input (MediaRecorder upload + server transcription; Web Speech enhancement)
- [ ] Job submission, durable queue, worker skeleton with real stage reporting
- [ ] Understand → select models → research (with book verification) → plan → script
- [ ] Kokoro TTS, segment assembly with ffmpeg, measured durations
- [ ] Episodes appear in the library as they complete
- [ ] Phase report

## Phase 3 — Thinking, Seeing, Doing
- [ ] Structured outcomes per episode in the plan stage
- [ ] Script prompts weaving Thinking/Seeing/Doing naturally
- [ ] Validation pass with the eight-point quality gate and bounded revision loop
- [ ] Source verification results surfaced in episode details
- [ ] Phase report

## Phase 4 — Photo and Video
- [ ] Camera capture and photo upload with limits; presigned direct upload
- [ ] Video record/upload; worker audio extraction, transcription, keyframe sampling, vision analysis
- [ ] Combined context in the understand stage; evidence vs assumption separation
- [ ] Retention and deletion policies; uploads never exposed on public pages
- [ ] Phase report

## Phase 5 — Library and Player
- [ ] Full player and mini-player with all required controls
- [ ] Episode details: primary model, supporting models, books, sources, takeaways, transcript
- [ ] Progress tracking with Not Started / In Progress / Completed (95% threshold, manual override)
- [ ] Favorites, ratings, continue listening, completed, search, sort, filters
- [ ] Phase report

## Phase 6 — Offline PWA
- [ ] Installability (Chromium prompt, iOS instructions, standalone detection)
- [ ] Downloads to IndexedDB with verification and storage estimates
- [ ] Offline playback and local progress/favorites/ratings
- [ ] Sync queue with conflict rules; sync on reopen, foreground and reconnect
- [ ] Service-worker update flow that never interrupts playback
- [ ] Real iPhone and Android checks recorded
- [ ] Phase report

## Phase 7 — AI Coaching
- [ ] Coach Me with full episode context and saved history
- [ ] Spoken questions and optional spoken answers
- [ ] Create a Podcast About This from a coaching session
- [ ] Phase report

## Phase 8 — Discovery and Continued Learning
- [ ] Public/private visibility, public pages with share previews
- [ ] Semantic search over public podcasts (pgvector)
- [ ] Existing-podcast suggestions before generation (public only)
- [ ] Explore / Deepen / Reinforce with model history tracking; topic updates
- [ ] Phase report

## Phase 9 — Administration and Reporting
- [ ] Admin dashboard: defaults, AI model config per stage, prompts with versions and test runs, limits
- [ ] Usage and cost analytics
- [ ] Bug reporting with diagnostics, email notifications, status workflow
- [ ] Admin MFA, audit logs
- [ ] Phase report

## Phase 10 — Final Validation
- [ ] Acceptance tests 1–42 from the spec, each with evidence
- [ ] Security testing and independent assessment
- [ ] Mobile performance, offline and accessibility testing
- [ ] Deployment verification on the production domain
- [ ] Documentation complete
