# Phase 10 report: final validation

Date: 2026-10-22.

**Status: built and validated locally. Not production-ready until the launch steps at the end are done.**

## Functional testing

| Suite | Result |
|---|---|
| Unit and integration (Vitest, 7 packages) | 302 passed |
| End-to-end (Playwright, iPhone 14 WebKit, Pixel 7 and desktop Chrome, against a production build) | 73 passed, 2 skipped by design (service-worker control is Chromium-only in Playwright) |
| Live end-to-end with a real model (qwen2.5 7B in Ollama), Kokoro voices and Open Library | Succeeded: a 5 min 50 s two-host episode with 2 verified books, passed review on the third draft |
| 60-minute episode (scripted model, test voice, real ffmpeg) | Passed; measured about 60 minutes |

The acceptance status for all 42 spec tests is in `docs/acceptance.md`: 33 verified, 9 partly verified, 0 not verified.

## Security testing

See `docs/security-assessment.md`.

- **Authorisation matrix.** 42 cases, mutation-checked.
- **Cross-site requests.** Origin checks reject other websites.
- **MFA regression.** Admin two-step verification can't be bypassed.
- **Upload attacks.** Disguised and oversized files are refused.
- **Production misconfiguration.** The server refuses to start without required settings.
- **Dependency audit.** No High or Critical findings; `sharp` was pinned to a patched version.
- **Secrets scan.** Nothing found.

The independent penetration test the spec requires has not been done.

## Accessibility testing

Automated axe checks (WCAG 2.0–2.2 A/AA) cover:

- **Signed out:** landing, sign-in, sign-up, password reset, help, discover, library and bug report.
- **Signed in:** create, customize, series, mini player, player, library and settings.

The suite fails on any serious or critical issue. It found two kinds:

- **Contrast.** The "Made" half of the on-screen wordmark used brand terracotta at 3.6:1. It now uses the accessible terracotta at 5.2:1. The logo files keep the exact brand colour.
- **Label in name (WCAG 2.5.3).** On the speed button, the download button and the mini player, the screen-reader name did not contain the visible text. All three now match. All colour pairs are recorded in `global.css`. Manual screen-reader testing has not been done.

## Final independent code review (Phases 2–9)

A fresh reviewer read all Phase 2–9 code and found no Critical issues. Each Important finding was fixed with a test that failed first:

1. **Content security policy.** It would have blocked direct uploads to R2 and offline downloads in production. The build now adds the R2 endpoint to `connect-src`.
2. **Rate limits.** Rate-limited jobs retried forever. Retries are now capped with exponential backoff, then the job fails with a plain message.
3. **False notification claim.** "Our team has been notified" was claimed for held episodes, but nothing sent a notification. Administrators are now emailed, every delivery is logged, and the sentence appears only if the email actually went out.
4. **Search indexing failures.** A failure could mark a finished series as failed, both when publishing and when making a series public. Indexing is now best-effort.
5. **Rejections.** Admin rejections were undone when another episode was approved. They now stick.
6. **Worker fencing.** A worker that lost its lease could still write results. Workers now check the lease before each stage and before final writes, and the lease is extended during research and media analysis.
7. **Visibility change.** Making a series public reported failure when only indexing failed. Fixed together with item 4.

Minor fixes:

- Share-page titles containing `$&` were garbled; they now stay literal.
- Other people now see only the finished episodes of a public series.
- `Range: bytes=-` now answers 416.
- A bad audit date now answers 400.
- The offline outbox drops an item after repeated server errors, so it can't block everything behind it.

Deferred minors:

- Rate-limit rows are never pruned.
- Discover's search embedding can be called by anonymous visitors. It's free with the built-in embedder, but could cost money with a paid one.
- Coach and prompt-test calls are capped by Vercel's 30-second function limit.
- Progress conflict rules trust device clocks.
- The concurrency check can allow one extra job when two workers poll at the same moment.

## Documentation

- `README.md`
- `docs/deployment.md` (Vercel, Neon, R2, email, DNS for `thinkmade.zicaworld.com`)
- `docs/worker.md` (Oracle VM with Docker)
- `docs/free-tier-limits.md`
- `docs/acceptance.md`
- `docs/security-assessment.md`
- `docs/licenses.md`
- phase reports 1–10

## Not done, and why

| Item | Why |
|---|---|
| Deployment and deployment verification | Needs your Vercel, Neon, Cloudflare and email accounts and the `zicaworld.com` DNS. Nothing is deployed. |
| A run with Groq | No API key on this machine. A local open model was used instead. |
| Real iPhone and Android testing | No devices are available to the build environment. Only emulated profiles were tested. |
| Independent security review and penetration test | Must be done by an independent party, as the spec requires |
| Worker Docker image build | Docker is not installed on this Mac. The Dockerfile is untested. |
| CI on GitHub | The workflow is on local branch `pending/ci-workflow`. Pushing it needs `gh auth refresh -s workflow`. |
| Manual screen-reader pass | Automated axe checks only |

## Launch checklist

1. Run `gh auth refresh -h github.com -s workflow`, then merge and push `pending/ci-workflow`.
2. Create Neon, R2 (with CORS) and Resend or Brevo. Set the Vercel environment variables listed in `deployment.md`, then deploy.
3. Add the `thinkmade` CNAME record shown by Vercel.
4. Run `npm run db:migrate` and `npm run seed:admin`, then turn on two-step verification.
5. Start the worker on the Oracle VM following `worker.md`.
6. Create a podcast with Groq, listen to it, and adjust prompts in Admin if needed.
7. Test on a real iPhone (installed to the home screen) and a real Android phone.
8. Commission the independent security review, fix any findings, and only then launch publicly.
