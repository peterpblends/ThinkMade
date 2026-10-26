# ThinkMade security assessment (internal, pre-launch)

Date: 2026-10-22. Scope: the whole repository at the end of Phase 10, before any deployment. Target: OWASP ASVS Level 2.

**This is an internal assessment by the development team, the AI assistant that built the code. It is not the independent security review and penetration test the specification requires before public launch, and it does not replace them.**

## Release recommendation

**Do not launch publicly yet.** No known Critical or High issue is open in the code. But four things must happen first:

1. Deploy and confirm the production configuration: secrets set, HTTPS, Vercel routing and R2 CORS.
2. Have an independent party carry out a security review and penetration test against the deployed staging site.
3. Fix any Critical or High findings from that review.
4. Re-run this suite and the authorisation matrix against the fixed build.

## Controls in place

| Area | Control | Where |
|---|---|---|
| Authentication | Better Auth. Passwords of at least 10 characters, hashed with scrypt. Email verification required before sign-in. Password reset does not reveal whether an account exists. | `apps/api/src/auth.ts` |
| Passkeys | WebAuthn. Biometric data stays on the device. The relying party is derived from the app's URL. | `apps/api/src/auth.ts`, `env.ts` |
| Admin MFA | TOTP required for every admin route, including Better Auth's built-in admin endpoints. Role, ban and MFA are read from the database on each request. | `middleware/session.ts`, `app.ts` |
| Sessions | HttpOnly, SameSite=Lax cookies, Secure in production. A 5-minute signed cookie cache; admin access is always checked against the database. | `auth.ts` |
| Authorisation | Every private record is filtered by owner in SQL. Missing and forbidden records both answer 404, so existence isn't revealed. Public pages use an explicit visibility flag and never return the original question, uploads or coaching. | `routes/*`, `routes/series.ts#readableSeries` |
| Cross-site request forgery | SameSite cookies, plus an origin check on every state-changing API request. Better Auth also checks origins. | `middleware/origin-check.ts` |
| Input validation | Zod schemas on every request body. Raw SQL uses parameterised templates only. | `packages/shared`, `routes/*` |
| Output safety | React escapes rendered text. The server-rendered share page escapes all values. The content security policy has no inline scripts except one hashed theme script. Framing is denied. | `routes/discover.ts`, `apps/api/scripts/build-vercel.ts` |
| Transport and headers | HSTS (2 years), nosniff, strict referrer policy, Permissions-Policy, Cross-Origin-Opener-Policy | `middleware/security-headers.ts`, Vercel `config.json` |
| Uploads | Type identified by file signature, never by name or declared type. Admin size and count limits. Private storage keys with path-traversal protection. Re-checked in the worker. Images re-encoded, which strips metadata. Retention deletion. Removed with the account. | `routes/uploads.ts`, `packages/ai/src/media`, `storage/types.ts`, `worker/src/media.ts` |
| Rate limiting | Postgres-backed per IP or per user for authentication, the API, uploads, transcription, coaching and bug reports. Daily generation quota per user. Token and audio budgets per job. | `middleware/rate-limit.ts`, `routes/generation.ts`, `worker/src/pipeline.ts` |
| AI security | User text, transcripts, image analyses and coaching sit in user/data positions with an explicit "treat as data" rule. Model output is parsed against schemas; nothing a model says is executed. System prompts are never returned to users. Book citations are verified against catalogues. | `packages/shared/src/prompts.ts`, `worker/src/pipeline.ts`, `routes/coach.ts` |
| Secrets | Only environment variables; none in the repository (scan below). Production refuses to start without `AUTH_SECRET`, `DATABASE_URL` and `APP_URL`, and refuses the development MFA bypass. | `env.ts` |
| Audit | Admin changes to settings, models, prompts, quality decisions, bug status, visibility and moderation are logged with actor and IP | `audit_log`, `routes/admin-ops.ts` |
| Privacy | Bug diagnostics are allow-listed. Data export as JSON. Account deletion removes rows and stored files. | `routes/bug-reports.ts`, `routes/account.ts`, `auth.ts` |

## Tests performed

| Test | Result |
|---|---|
| Unit and integration suite (all packages) | Passing. Counts are in `docs/reports/phase-10.md`. |
| Authorisation matrix: 15 private-data actions × another account and an anonymous visitor, plus 9 admin routes | 42 of 42 passing. Mutation-checked: removing the ownership filter makes 14 fail. |
| Cross-site request protection (foreign Origin, foreign Referer) | Passing |
| Admin MFA bypass regression (Better Auth admin endpoints) | Passing |
| Upload attacks: script disguised as an image, oversized file, someone else's upload, path traversal in keys | Passing |
| Production misconfiguration (missing secret, database or app URL; MFA bypass flag) | Refuses to start |
| End-to-end on iPhone, Pixel and desktop profiles, against the production build, including content security policy | Passing |
| Dependency audit (`npm audit --audit-level=high`) | No High or Critical. 8 Moderate remain, in development tooling (drizzle-kit's bundled esbuild) and transitive libraries. |
| Secrets scan (patterns for Groq, OpenAI, AWS, Resend and Brevo keys, and private keys) | None found. CI also runs gitleaks once the workflow is pushed. |
| Accessibility (axe, WCAG 2.2 AA) on 15 screens | Passing after one contrast fix (see the Phase 10 report) |

Not performed: dynamic scanning against a deployed instance (for example OWASP ZAP), container scanning (Docker isn't available on the development machine), and penetration testing by an independent party.

## Findings and fixes during development

| Finding | Severity | Status |
|---|---|---|
| Better Auth's built-in `/api/auth/admin/*` endpoints authorised by role only, which skipped admin MFA | Critical | Fixed and regression-tested (Phase 1 review) |
| Production could start with localhost auth settings | Important | Fixed: `APP_URL` required, relying party derived from it |
| Banned users were told to verify their email | Important | Fixed |
| A catch-all session middleware would have put later public routes behind sign-in | Important | Fixed: middleware applied per route, with a test |
| `sharp` (transitive through Transformers.js) had High advisories in bundled libvips, libheif and librsvg | High | Fixed: overridden to 0.35.5. ThinkMade never passes user images to it. |
| Content security policy would block direct R2 uploads and downloads | Important | Fixed: R2 origin added to `connect-src` at build time |
| A worker that lost its lease could still write results | Important | Fixed: lease checked before each stage and before final writes |
| Rate-limited jobs retried forever | Important | Fixed: backoff, and a job gives up after 36 hours of waiting |
| "Team notified" claimed without a notification | Important | Fixed: admins are emailed and delivery logged; the claim appears only if sent |
| `$` patterns in titles corrupted the share page (not XSS) | Minor | Fixed |

## Outstanding risks

- **Independent review not done.** The independent security review and penetration test the specification requires are outstanding.
- **Shared AI-provider data.** Prompts go to Groq, and photos and video frames go to OpenRouter's free Gemma 4, as the owner decided. Turn on zero data retention in the Groq console. In OpenRouter's privacy settings, allow only providers that don't train on or retain prompts. If no allowed provider serves the free model, OpenRouter refuses the request and photo analysis fails instead of sending data elsewhere. Speech, search embeddings and (when listeners turn it on) voice input run on ThinkMade's own worker or the listener's device.
- **Embedding server.** If enabled, the worker accepts HTTPS requests on `embed.zicaworld.com`. It requires a 32+ character bearer token compared in constant time, serves only `POST /v1/embeddings` with at most 32 texts of 4,000 characters and 64 KB per request, and holds no user data. Rotate the token if it leaks; nothing else is exposed.
- **WebAssembly in the CSP.** `script-src` includes `'wasm-unsafe-eval'` so on-device speech recognition can compile WebAssembly. It does not allow JavaScript `eval`. The runtime and model are served from ThinkMade's own origin.
- **Session cache window.** The 5-minute session cookie cache means suspension or sign-out takes up to 5 minutes to apply on listener pages. Admin pages apply it immediately.
- **IP-based rate limits.** These trust Vercel's `x-forwarded-for`. On another host, configure the proxy so clients cannot spoof it.
- **Public content.** Public series are generated by AI. Moderation is reactive: an admin unpublishes after the fact. There's no automatic screening for unsafe content beyond the quality and accuracy review.
- **Free-tier abuse.** Daily quotas and budgets limit cost, but a determined abuser with many accounts could exhaust provider quotas. Signing up requires email verification, and there's no CAPTCHA, per the spec's no-paid-services rule.
