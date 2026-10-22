# Phase 1 report — Foundation

Date: 2026-10-22. Branch: `main`. Plan: `docs/superpowers/plans/2026-10-22-phase-1-foundation.md`.

**Status: the foundation works locally and passes its tests. It has not been deployed. ThinkMade cannot yet generate podcasts. That is Phase 2.**

## Features completed

- **Monorepo.** TypeScript workspaces cover the web app, API, database, shared settings, provider adapters and brand.
- **Brand.** The "thinking fingerprint" symbol has an outlined Newsreader wordmark. The logo comes in horizontal, stacked, light, dark and mono versions. The build also produces app icons, maskable icons, an Apple touch icon, favicons and a social card, all from one source file.
- **Mobile app shell.** The bottom bar has exactly three tabs: Create, Discover and My Library. Profile, Settings, Help, Report a Bug, Install and Admin sit in the account menu. The shell handles safe areas and supports light, dark and system appearance.
- **Create screen.** It asks "What would you like to think through today?" and offers one main button. Customize is optional and covers length, episodes, hosts and learning mode, prefilled from admin defaults. Voice, photo and video show as "coming soon". Pressing Create says plainly that generation arrives in the next release.
- **Accounts.** Sign-up with required email verification, sign-in, and password reset all work. So do passkeys (Face ID, Touch ID or device PIN through WebAuthn), TOTP two-step verification with backup codes, profile name, data export as JSON, and account deletion.
- **Admin.** Settings are stored as numbered versions, and rollback creates a new version. Every change is audit-logged. Admin routes require the admin role and two-step verification, checked against the database on every request. A `seed:admin` command creates the first administrator.
- **API security.** Security headers and a content security policy go on every response. Rate limits are stored in Postgres: 20 credential attempts per IP per 15 minutes, and 300 API calls per user per 15 minutes. All request bodies are validated.
- **PWA.** The manifest, service worker and offline app shell are in place. A new version waits for the user's tap, so it never interrupts playback. Install works through the browser prompt on Chromium and through instructions on iOS.
- **Vercel.** The build writes `.vercel/output`, containing the static app and one bundled API function. `docs/deployment.md` lists the exact domain and DNS steps for `thinkmade.zicaworld.com`.

## Tests performed

| Suite | Result |
|---|---|
| Unit and integration (Vitest, 6 packages) | 76 passed |
| End-to-end (Playwright, iPhone 14, Pixel 7 and desktop Chrome profiles, against a production build) | 32 passed, 1 skipped (the WebKit service-worker test, by design) |
| Lint and typecheck | Clean |
| `npm audit --audit-level=high` | Passes. 4 moderate findings, all in development-only drizzle-kit tooling. |
| Manual | Logo reviewed at 16–512 px. App reviewed at 375×812 in light and dark. CSP checked in a browser against the built output. A fresh-clone `npm run dev` went through sign-up, console email link, verification and admin promotion. |

The end-to-end tests cover several behaviours:

- Name, tagline and purpose are visible.
- No page scrolls sideways at phone width.
- Tab targets are at least 44 px.
- The manifest is correct.
- A full sign-up, email verification and sign-in flow works.
- An unverified sign-in shows a notice with a resend option.
- The passkey button is hidden without WebAuthn.
- Signed-out users are redirected away from private pages.
- The app shell opens offline.

Contrast ratios for every text and background pair were calculated and all meet WCAG AA (4.5:1). The values are recorded in `apps/web/src/styles/global.css`.

## Not yet completed

- **Deployment.** Nothing is deployed. It needs a Vercel project, a Neon database, environment variables, and a CNAME record for `thinkmade` at the `zicaworld.com` DNS host. `vercel build` has not been run, because it needs a linked Vercel project.
- **Email delivery.** Emails print to the server log. **A production deploy cannot verify new accounts until Resend or Brevo is connected.** That work is scheduled for Phase 9 and should move earlier, before any public deploy.
- **Real-device testing** on iPhone and Android. Only emulated so far.
- **CI on GitHub.** The workflow is committed but has not been seen to pass there yet.
- **Customize free-form values** (custom minutes or episode count). Fixed choices cover the spec's options for now.
- **Bug reports.** The form exists, but the API answers "not implemented" and the app says the report was not sent. Phase 9 adds storage, screenshots and email.
- **Discover and Library** are honest placeholders until Phases 5 and 8.
- **Lighthouse audit** has not been run.

## Known issues

- The main JavaScript bundle is 158 KB gzipped, most of it React, the router and the auth client. Splitting more of the auth client out is a later optimisation.
- Passkeys work only on the production domain. Preview deployments have changing hostnames, so they use email and password.
- The in-app browser used for manual checks blocks service workers. Playwright's Chromium confirms they work.

## Security considerations

- Passwords are hashed by Better Auth with scrypt. Cookies are HttpOnly, SameSite=Lax, and Secure in production. Email verification is required before sign-in.
- Admin access needs the admin role, a verified email, no ban, and TOTP. The `ADMIN_SKIP_2FA` development flag is refused in production.
- ThinkMade stores no biometric data. Passkeys keep that on the device.
- The password-reset request returns the same message whether or not an account exists.
- Production refuses to start without `AUTH_SECRET` and `DATABASE_URL`.
- The CSP allows only the app's own scripts plus one hashed inline theme script, and blocks framing.
- The data export leaves out password hashes, tokens and secrets. A test checks this.
- An independent security review and penetration test are still required before public launch (spec §22, Phase 10).

## Infrastructure dependencies

Vercel (Hobby, the owner's decision; see the plan note in `deployment.md`), Neon Postgres, Cloudflare R2 from Phase 2, an email provider, Groq (owner-approved) and an Oracle Always Free VM for the worker from Phase 2. Current limits are in `docs/free-tier-limits.md`.

## Recommended next steps

1. The owner creates the Vercel project and Neon database, then adds the DNS record, following `docs/deployment.md`.
2. Connect an email provider before any public deploy.
3. Start Phase 2: worker, queue, Groq adapter, book verification, scripts, Kokoro speech and ffmpeg assembly.
4. Check the app on a real iPhone and an Android phone once a preview deploy exists.
