# Acceptance tests: status and evidence

This covers the 42 mandatory acceptance tests from the master specification, section 28. It was assessed on 2026-10-22, before any deployment.

**Legend**

- **Verified.** Shown by an automated test that runs in this repository, or by a recorded live run.
- **Partly verified.** Shown in automated or emulated conditions. A check the spec requires, such as a real device, a live provider or a deployment, has not been done.
- **Not verified.** No evidence yet.

"Live run" means a real local language model (qwen2.5 7B in Ollama), real Kokoro voices and live Open Library verification on the development Mac. The output is in `.data/live-check-3/`, and you can repeat it with `npm run live-check -w apps/worker`. Test files are relative to the repository root. E2E means Playwright on iPhone 14, Pixel 7 and desktop Chrome profiles, against a production build.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Shows ThinkMade, tagline and purpose | Verified | `apps/web/e2e/shell.spec.ts`: landing shows name, tagline and purpose |
| 2 | Logo works at phone icon sizes | Verified | `packages/brand/scripts/build-icons.test.ts` covers every size and the maskable safe zone; visual review at 16–512 px |
| 3 | Mobile interface feels native | Partly verified | E2E on phone profiles checks no sideways scrolling, 44 px targets, safe areas and the mini player. Not yet tried on a physical iPhone or Android. |
| 4 | Users can install the PWA | Partly verified | E2E checks the manifest and that the service worker installs with an offline shell. Install prompt and iOS instructions exist. Not installed on a real device. |
| 5 | Podcasts from only a topic and Create | Verified | `apps/web/e2e/generation.spec.ts` gives topic in, playable MP3 out |
| 6 | Administrator defaults work | Verified | `apps/api/src/routes/generation.test.ts`: a job created with defaults only; admin limits enforced |
| 7 | Voice topic input works | Partly verified | Recording-hook and form tests, plus API transcription tests with a stand-in recogniser. Groq Whisper is not run (no key). Microphone capture is not automated. |
| 8 | Photo topic input works | Partly verified | `apps/web/e2e/media.spec.ts` creates from a photo alone; worker tests with real images. A real vision model has not been run (no vision provider configured). |
| 9 | Video topic input works | Partly verified | `apps/worker/src/media.test.ts` uses a real generated video for key frames and soundtrack extraction. Vision and transcription are stand-ins. |
| 10 | Optional customization works | Verified | `apps/web/src/screens/create-form.test.tsx`; E2E sets 5 minutes and 1 episode; limits enforced by the API |
| 11 | Real playable audio | Verified | E2E plays the MP3 in the browser; live run produced a 5 min 50 s two-voice episode with Kokoro |
| 12 | Supports the maximum duration | Verified (test voice) | `apps/worker/src/long-episode.test.ts` builds a 60-minute episode in 15 sections and measures about 60 minutes from the file. Real Kokoro at 60 minutes not timed; expect roughly 30 min of CPU on an M2 Pro. |
| 13 | Primary mental models identified | Verified | Pipeline tests; shown on series, player and public pages |
| 14 | Every episode teaches Thinking | Verified | Plan stage requires the outcome; quality gate scores it; held if below threshold (`apps/worker/src/pipeline.test.ts`, quality gate) |
| 15 | Every episode teaches Seeing | Verified | As above |
| 16 | Every episode teaches Doing | Verified | As above |
| 17 | These flow naturally | Partly verified | Gate scores flow and rejects announced labels. In the live run a real script was rewritten twice before passing. Naturalness is ultimately a human judgement; the admin spot-check exists. |
| 18 | Sources verified or qualified | Verified | Only books matched in Open Library or Google Books are cited; invented titles rejected (`packages/ai/src/books/verify.test.ts`, live run). Episodes without a verifiable book say so. |
| 19 | Podcasts save to the library | Verified | E2E library tests |
| 20 | Downloaded episodes play offline | Verified (Chromium) | `apps/web/e2e/offline.spec.ts`. Not tested on an installed iPhone. |
| 21 | Playback position preserved | Verified | `apps/web/e2e/player.spec.ts`: resume after reload |
| 22 | Offline updates sync safely | Verified | `packages/shared/src/playback.test.ts`; `apps/web/src/offline/offline.test.ts`; offline E2E reaches the server after reconnect |
| 23 | Completion tracked | Verified | Playback rules and API tests: 95% threshold, manual override |
| 24 | Ratings and favorites work | Verified | API tests and player E2E |
| 25 | Coach Me answers contextually | Verified (stand-in model) | `apps/api/src/routes/coach.test.ts` checks question, model, transcript excerpts and history are in context. Not tried with Groq. |
| 26 | Coaching history private | Verified | Coach tests and the authorisation matrix |
| 27 | Podcasts from coaching | Verified | Coach API test and `apps/web/e2e/coach.spec.ts` |
| 28 | Public search works | Verified | `apps/api/src/routes/discover.test.ts` and `apps/web/e2e/discover.spec.ts` |
| 29 | Private content protected | Verified | `apps/api/src/security/authorization-matrix.test.ts` runs 42 cross-account and anonymous attempts, and it was mutation-checked |
| 30 | Sharing works | Verified | Discover E2E plays a share link signed out; preview tags tested |
| 31 | Existing relevant podcasts suggested | Verified | Discover API test: suggestions exclude own and private series |
| 32 | Repeated models avoided unless reinforcing | Verified | Pipeline test for Explore; continued-learning tests for Deepen and Reinforce |
| 33 | Bug reports saved | Verified | `apps/api/src/routes/admin-ops.test.ts`; `apps/web/e2e/admin.spec.ts` |
| 34 | Administrator email configuration works | Partly verified | The address set in Defaults receives the report (memory sender), and failures are recorded. Resend and Brevo tested against stubbed APIs only; no real email sent. |
| 35 | Administrative settings secured | Verified | Admin role and two-step verification required, including Better Auth's admin endpoints; audit log (matrix and admin tests) |
| 36 | Auth and authorisation pass security tests | Partly verified | Internal tests pass (matrix, origin checks, rate limits, MFA). The independent security review and penetration test the spec requires have not been done. |
| 37 | Media uploads protected | Verified | Content-signature checks, size limits, owner-only access, retention and deletion on account removal (upload, media and auth tests) |
| 38 | Vercel deployment configuration works | Partly verified | `npm run build:vercel` produces Build Output v3 and the bundled function serves requests in tests. Not deployed; `vercel build` needs the owner's project. |
| 39 | Custom domain documented | Verified | `docs/deployment.md`, section 5 |
| 40 | Free-tier limitations documented | Verified | `docs/free-tier-limits.md`; dashboard alerts at 80% |
| 41 | Failed operations produce honest errors | Verified | Missing provider, quality hold, failed email, offline and unsupported media cases are all tested |
| 42 | Nothing unfinished represented as complete | Verified | This document and `docs/reports/` list every gap |

## What must happen before public launch

1. Deploy: Vercel project, Neon, R2, email and the Oracle worker, then confirm `/api/health` reports `"db":"pg"`.
2. Run a full episode with the production model (Groq) and listen to it.
3. Test on a real iPhone (installed to the home screen) and a real Android phone.
4. Commission an independent security review and penetration test. See `docs/security-assessment.md`.
