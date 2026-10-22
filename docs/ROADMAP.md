# ThinkMade — Implementation Roadmap and Progress Checklist

Tracks the ten phases from the master spec. A box is ticked only when the item is implemented and verified (tests or a real-device check), never when it merely exists as a stub.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified · `[!]` blocked (reason noted)

## Phase 1 — Foundation
- [x] Monorepo structure (apps/web, apps/api, packages/db, packages/shared, packages/ai, packages/brand). `apps/worker` arrives with Phase 2.
- [x] Development environment: embedded Postgres (PGlite with pgvector), `.env.example`, one-command `npm run dev`
- [x] Design tokens and Tailwind theme, light and dark, AA contrast measured
- [x] Logo and brand assets, rendered and reviewed at 16–512 px
- [x] Mobile shell: three-tab bottom navigation, account menu, safe areas, no horizontal overflow (Playwright iPhone, Pixel, desktop)
- [x] Accounts: register, verify email, sign in, reset password, passkeys, two-step verification, sign out, delete account, export data
- [x] Database schema and migrations for the core model
- [x] Admin settings store with versioning, rollback and audit log; spec defaults seeded; admin screen
- [~] Vercel: build output, routing, headers and docs done. **Not deployed:** it needs the owner's Vercel, Neon and DNS access.
- [~] CI workflow written (lint, types, tests, audit, e2e, secret scan). **Not yet observed green on GitHub.**
- [ ] Real iPhone and Android device check. Only Playwright device emulation so far.
- [x] Phase report: `docs/reports/phase-1.md`

## Phase 2: Core Podcast Generation
- [x] Create screen submits for real; voice input (recording plus server transcription, with Web Speech fallback)
- [x] Durable job queue and worker, with real progress stages
- [x] Understand, select models, research with book verification, plan, script
- [x] Kokoro speech and ffmpeg assembly, with durations measured from the file
- [x] Episodes appear as they complete. See `reports/phase-2.md`.

## Phase 3: Thinking, Seeing, Doing
- [x] Outcomes in the plan; scripts weave them together naturally
- [x] Eight-point quality review with a revision loop, holding failures for people. See `reports/phase-3.md`.

## Phase 4: Photo and Video
- [x] Content-checked private uploads, presigned R2 uploads, and retention
- [x] Video key frames, soundtrack transcription and vision analysis (evidence kept apart from assumptions). See `reports/phase-4.md`.

## Phase 5: Library and Player
- [x] Full player and mini player, Media Session, progress rules, favourites, ratings, completion
- [x] Library tabs, search, filter and sort; delete; visibility. See `reports/phase-5.md`.

## Phase 6: Offline PWA
- [x] Verified downloads, offline playback, offline-first outbox sync, and playback-safe updates
- [ ] Real iPhone and Android device checks (emulated only). See `reports/phase-6.md`.

## Phase 7: AI Coaching
- [x] Context-aware Coach Me, saved history, voice in and out, and Create a Podcast About This. See `reports/phase-7.md`.

## Phase 8: Discovery and Continued Learning
- [x] Public search, reuse suggestions, share pages with previews, saving others' series
- [x] Explore, Go Deeper, Reinforce and Update. See `reports/phase-8.md`.

## Phase 9: Administration and Reporting
- [x] Admin dashboard: usage and alerts, AI models with tests, versioned prompts with test runs, quality queue, bug reports, people, moderation, audit log
- [x] Bug reporting with safe diagnostics, screenshots and logged email notifications. See `reports/phase-9.md`.

## Phase 10: Final Validation
- [x] Acceptance tests 1–42 with evidence (`acceptance.md`: 33 verified, 9 partly verified)
- [x] Security testing: authorisation matrix, cross-site request checks, upload attacks, audit, secrets scan; internal assessment (`security-assessment.md`)
- [x] Final independent code review; all Important findings fixed with tests
- [x] Automated accessibility (axe, WCAG 2.2 AA) on main screens; offline and mobile-profile testing
- [x] Documentation complete
- [ ] Independent security review and penetration test (needs an outside party)
- [ ] Deployment verification on thinkmade.zicaworld.com (needs the owner's accounts)
- [ ] Real-device mobile testing
See `reports/phase-10.md`.
