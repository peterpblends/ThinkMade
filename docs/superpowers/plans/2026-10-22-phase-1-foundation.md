# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buildable, testable ThinkMade monorepo with the brand, the mobile app shell, working accounts (email, verification, passkeys, admin two-factor), the core database schema, a versioned admin settings store, Vercel configuration and CI.

**Architecture:** npm-workspaces monorepo. `packages/db` owns the Drizzle schema and a `createDb` factory that runs on PGlite (dev and tests) or `pg` (Neon in production). `apps/api` is a Hono app that mounts Better Auth and the settings service; it runs locally on Node and on Vercel through `api/index.ts`. `apps/web` is a Vite React PWA with Tailwind v4 tokens. `packages/brand` holds the logo sources and generates every icon the PWA and social cards need.

**Tech Stack:** TypeScript 5.x (strict), Node 26, React 19, Vite 8, Tailwind CSS 4, vite-plugin-pwa 2, React Router 8, TanStack Query 5, Hono 4, Better Auth 1.7 (+ passkey, twoFactor, admin plugins), Drizzle ORM 0.45 + drizzle-kit, PGlite 0.5 (+ pgvector extension), pg 8, Zod 4, Vitest 5, Playwright 1.64, @resvg/resvg-js, ESLint 10 + typescript-eslint.

**Spec:** `docs/superpowers/specs/2026-10-22-thinkmade-architecture-design.md` and `docs/MASTER-BUILD-SPEC.md` §§1–6, 8, 19, 22, 24–27.

## Global Constraints

- Brand strings exactly: name `ThinkMade`; tagline `Better Thinking. Made Personal.`; promise `Don't just learn more. Learn to think better.`; short description `Personalized podcasts that teach you how to think.`
- Colors exactly: Warm Ivory `#F7F4EE`, Deep Charcoal `#292929`, Terracotta `#C56B4E`, Sage Green `#829284`, Soft White `#FFFFFF`. Light and dark appearance both required; WCAG 2.2 AA contrast.
- Primary navigation: exactly three tabs, labelled `Create`, `Discover`, `My Library`, in that order.
- Main screen prompt: `What would you like to think through today?`; main button `Create My Podcasts`; secondary `Customize`.
- Admin defaults (spec §8): length 15 min, 3 episodes, speaker format Mixed, learning mode Explore, privacy Private, language English, max episode 60 min.
- No paid services. No system-level installs on the dev Mac (no Homebrew, no Docker): every dependency is an npm package.
- Mobile first: no horizontal overflow at 375 px width; touch targets ≥ 44 × 44 px; safe-area insets respected.
- Security: HttpOnly Secure SameSite cookies; email verification required before any generation; admin routes require the `admin` role and two-factor enabled; all admin writes audit-logged; CSP and HSTS headers on every response.
- Honesty: no feature appears finished that is not; the Create button must state that generation is not available until Phase 2 ships.

## Review Focus

1. A signed-in user whose email is not yet verified opens Create — the screen must say verification is required and offer to resend, not fail silently (Task 7 test `unverified user sees verification notice`).
2. A second admin settings update arriving while a rollback is in flight — versions must stay monotonic and exactly one row `active` (Task 5 test `concurrent updates keep one active version`).
3. A 375 px wide phone with a long tagline and a software keyboard open — the bottom nav must stay reachable and no element may overflow (Task 7 Playwright test `no horizontal overflow on phone`).
4. A browser without WebAuthn support on the sign-in page — the passkey button must be hidden and email sign-in still works (Task 7 test `passkey button hidden without WebAuthn`).
5. Running `npm run dev` on a fresh clone with no `.env` — the API must boot on PGlite with a generated dev secret and print a warning, not crash (Task 9 test `boots without env`).

---

### Task 1: Monorepo scaffold and shared package

**Files:**
- Create: `package.json` (workspaces: `apps/*`, `packages/*`; scripts `dev`, `build`, `test`, `lint`, `typecheck`, `format`), `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.editorconfig`, `.nvmrc` (`26`), `.env.example`
- Create: `packages/shared/package.json` (name `@thinkmade/shared`, `type: module`, `exports` → `src/index.ts`), `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/brand.ts`, `packages/shared/src/settings.ts`
- Test: `packages/shared/src/settings.test.ts`, `packages/shared/src/brand.test.ts`

**Interfaces:**
- Produces: `BRAND` const `{ name, tagline, promise, shortDescription, fullDescription, colors: { warmIvory, deepCharcoal, terracotta, sageGreen, softWhite } }`.
- Produces: `appSettingsSchema` (Zod object) and `DEFAULT_APP_SETTINGS: AppSettings` with fields: `podcast: { defaultLengthMinutes: 15, defaultEpisodes: 3, maxEpisodeMinutes: 60, maxEpisodesPerSeries: 10, speakerFormat: 'mixed', learningMode: 'explore', visibility: 'private', language: 'en', teachingStyle: 'conversational_practical', sourceQuality: 'verified', audioQuality: 'balanced' }`, `voices: { single: 'af_heart', hostA: 'af_heart', hostB: 'am_michael', available: string[] }`, `media: { maxImages: 4, maxImageBytes: 10_485_760, maxVideoSeconds: 120, maxVideoBytes: 104_857_600 }`, `limits: { generationConcurrency: 2, perUserDailyJobs: 5, maxTokensPerJob: 400_000, maxAudioMinutesPerJob: 240 }`, `bugReports: { email: '' }`. Enum types `SpeakerFormat = 'single' | 'two_hosts' | 'mixed'`, `LearningMode = 'explore' | 'deepen' | 'reinforce'`, `Visibility = 'private' | 'public'`.
- Produces: `appSettingsPatchSchema` = deep-partial of `appSettingsSchema`.

- [ ] **Step 1: Write failing tests** — `settings.test.ts`: `DEFAULT_APP_SETTINGS parses against appSettingsSchema`; `patch schema rejects defaultLengthMinutes above maxEpisodeMinutes` (use a `superRefine`); `patch schema accepts a partial { podcast: { defaultEpisodes: 5 } }`. `brand.test.ts`: `BRAND.tagline === 'Better Thinking. Made Personal.'`, colors match the five hex values.
- [ ] **Step 2: Run** `npm test -w packages/shared` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** root tooling and the two modules.
- [ ] **Step 4: Run** `npm test -w packages/shared && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `chore: monorepo scaffold and shared package`.

### Task 2: Database package with PGlite and Postgres drivers

**Files:**
- Create: `packages/db/package.json` (`@thinkmade/db`), `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/auth.ts`, `packages/db/src/schema/settings.ts`, `packages/db/src/schema/learning.ts`, `packages/db/src/schema/library.ts`, `packages/db/src/schema/ops.ts`, `packages/db/migrations/*` (generated)
- Test: `packages/db/src/client.test.ts`

**Interfaces:**
- Produces: `createDb(options: { databaseUrl?: string; pgliteDir?: string | ':memory:' }): Promise<DbHandle>` where `DbHandle = { db: Db; kind: 'pg' | 'pglite'; close(): Promise<void> }` and `Db` is the Drizzle instance typed with the full schema. If `databaseUrl` is set, use `drizzle-orm/node-postgres` with a `pg.Pool`; otherwise `drizzle-orm/pglite` with the `vector` extension loaded.
- Produces: `runMigrations(handle: DbHandle): Promise<void>` — executes `CREATE EXTENSION IF NOT EXISTS vector` then the Drizzle migrator for the handle's driver, migrations folder resolved relative to the package.
- Produces: schema tables (snake_case names). Auth (Better Auth shape, generated then committed): `user` (+ `role`, `banned`, `ban_reason`, `ban_expires`, `two_factor_enabled`), `session` (+ `impersonated_by`), `account`, `verification`, `passkey`, `two_factor`. Settings: `app_setting` (`id`, `name`, `version`, `document` jsonb, `active` bool, `created_by`, `created_at`, `note`) with unique `(name, version)` and a partial unique index on `(name) where active`; `audit_log` (`id`, `actor_id`, `action`, `target_type`, `target_id`, `before` jsonb, `after` jsonb, `ip`, `created_at`). Learning: `learning_request`, `mental_model` (+ `embedding vector(384)`), `mental_model_relation`, `author`, `book`, `book_author`, `source`, `podcast_series`, `episode`, `episode_mental_model`, `episode_source`, `episode_quality_check`. Library: `library_item`, `playback_state`, `favorite`, `rating`, `download_manifest`, `sync_event`, `coaching_session`, `coaching_message`. Ops: `generation_job`, `generation_stage`, `media_upload`, `bug_report`, `email_delivery`, `usage_metric`, `rate_limit` (`key` text pk, `window_start` timestamptz, `count` int), `ai_model_config`, `prompt_version`. Column lists follow design §4; every user-owned table has `user_id` FK with `on delete cascade`.

- [ ] **Step 1: Write failing test** — `client.test.ts`: `migrations apply on pglite and vector extension is usable` (create handle `:memory:`, run migrations, `SELECT '[1,2,3]'::vector(3)` succeeds, insert into `user` and read back); `app_setting allows only one active version per name` (insert two active rows for `name='app'` → second insert rejects).
- [ ] **Step 2: Run** `npm test -w packages/db` — Expected: FAIL.
- [ ] **Step 3: Implement** schema files, `createDb`, `runMigrations`; run `npx drizzle-kit generate` to produce the migration SQL; commit the generated folder.
- [ ] **Step 4: Run** `npm test -w packages/db` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): core schema, pglite/pg client and migrations`.

### Task 3: Email adapter and auth configuration

**Files:**
- Create: `packages/ai/package.json` (`@thinkmade/ai`), `packages/ai/tsconfig.json`, `packages/ai/src/index.ts`, `packages/ai/src/email/types.ts`, `packages/ai/src/email/console.ts`, `packages/ai/src/email/memory.ts`
- Create: `apps/api/package.json` (`@thinkmade/api`), `apps/api/tsconfig.json`, `apps/api/src/auth.ts`, `apps/api/src/env.ts`
- Test: `apps/api/src/auth.test.ts`

**Interfaces:**
- Produces: `interface EmailSender { send(message: { to: string; subject: string; text: string; html?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> }`; `consoleEmailSender(): EmailSender`; `memoryEmailSender(): EmailSender & { sent: EmailMessage[] }`.
- Produces: `loadEnv(source?: NodeJS.ProcessEnv): Env` with Zod-validated `{ NODE_ENV, PORT (default 8787), DATABASE_URL?, PGLITE_DIR (default '.data/pglite'), AUTH_SECRET (generated with a logged warning when missing outside production; required in production), APP_URL (default 'http://localhost:5173'), API_URL (default 'http://localhost:8787'), PASSKEY_RP_ID (default 'localhost') }`.
- Produces: `createAuth(deps: { db: Db; env: Env; email: EmailSender }): Auth` — Better Auth with `drizzleAdapter(db, { provider: 'pg' })`, `emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 10 }`, `emailVerification.sendVerificationEmail` and `sendResetPassword` via `deps.email`, `trustedOrigins: [env.APP_URL]`, plugins `passkey({ rpID, rpName: 'ThinkMade', origin: env.APP_URL })`, `twoFactor({ issuer: 'ThinkMade' })`, `admin()`, `user.deleteUser.enabled = true`, `appName: 'ThinkMade'`, `session.cookieCache` enabled 5 min.

- [ ] **Step 1: Write failing tests** — `auth.test.ts` (PGlite in memory, `memoryEmailSender`): `sign up sends a verification email and blocks sign-in until verified` (POST `/api/auth/sign-up/email` → one email captured containing a URL with `token=`; POST sign-in returns 403 until the verification URL is fetched; afterwards sign-in returns a `set-cookie` header); `password reset email is sent for existing accounts`; `loadEnv generates AUTH_SECRET outside production and throws in production`.
- [ ] **Step 2: Run** `npm test -w apps/api` — Expected: FAIL.
- [ ] **Step 3: Implement** the email adapter, `env.ts`, `auth.ts`. Run `npx @better-auth/cli generate` against the config to produce the auth schema, reconcile it with `packages/db/src/schema/auth.ts`, regenerate migrations if the shape differs.
- [ ] **Step 4: Run** `npm test -w apps/api` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): better-auth with passkeys, two-factor, admin roles`.

### Task 4: Hono app, security middleware and rate limiting

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/middleware/security-headers.ts`, `apps/api/src/middleware/session.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/server.ts`, `apps/api/src/create-context.ts`
- Test: `apps/api/src/app.test.ts`, `apps/api/src/middleware/rate-limit.test.ts`

**Interfaces:**
- Produces: `createApp(ctx: AppContext): Hono<{ Variables: { session: SessionData | null } }>` where `AppContext = { db: Db; auth: Auth; env: Env; email: EmailSender; settings: SettingsService; now?: () => Date }` (SettingsService from Task 5; Task 4 stubs it with `settingsService` from Task 5's interface).
- Produces: `createContext(options?: { env?: Env; email?: EmailSender; pgliteDir?: string }): Promise<AppContext & { close(): Promise<void> }>` — builds db, runs migrations, seeds default settings if absent, builds auth.
- Produces: `rateLimit(opts: { key: (c) => string; limit: number; windowSeconds: number })` Hono middleware backed by the `rate_limit` table (fixed window, upsert). Applied: auth routes 20 req / 15 min per IP; `/api/*` 300 req / 15 min per user-or-IP.
- Produces: `securityHeaders()` setting `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: https:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`.
- Produces: `requireSession()` (401 when none), `requireVerified()` (403 `{ error: 'email_not_verified' }`), `requireAdmin()` (403 unless `role` includes `admin` and `twoFactorEnabled` is true; in non-production `ADMIN_SKIP_2FA=true` env allows skipping, logged).
- Routes: `GET /api/health → { ok: true, version, db: 'pglite' | 'pg' }`; `GET /api/me → { user: { id, email, name, emailVerified, role, twoFactorEnabled } }`.

- [ ] **Step 1: Write failing tests** — `app.test.ts`: `health responds with security headers`; `me requires a session` (401); `admin route forbids non-admin` (403 for a verified normal user hitting `GET /api/admin/settings`); `admin route forbids admin without two-factor` (403). `rate-limit.test.ts`: `returns 429 after the limit within the window` (limit 3 → fourth call 429 with `Retry-After`).
- [ ] **Step 2: Run** `npm test -w apps/api` — Expected: FAIL.
- [ ] **Step 3: Implement** middleware, routes, `createApp`, `createContext`, `server.ts` (`@hono/node-server` on `env.PORT`).
- [ ] **Step 4: Run** `npm test -w apps/api` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): hono app with session, admin and rate-limit middleware`.

### Task 5: Versioned admin settings store

**Files:**
- Create: `apps/api/src/settings/settings-service.ts`, `apps/api/src/routes/settings.ts`, `apps/api/src/routes/admin-settings.ts`
- Modify: `apps/api/src/app.ts` (mount routes)
- Test: `apps/api/src/settings/settings-service.test.ts`, `apps/api/src/routes/admin-settings.test.ts`

**Interfaces:**
- Produces: `createSettingsService(db: Db): SettingsService` with `getActive(): Promise<{ version: number; settings: AppSettings }>`, `update(patch: AppSettingsPatch, actor: { id: string; ip?: string }, note?: string): Promise<{ version: number; settings: AppSettings }>` (deep-merge onto active, validate with `appSettingsSchema`, insert as `version = max+1` and flip `active` inside one transaction, write `audit_log` action `settings.update`), `listVersions(): Promise<Array<{ version: number; createdAt: Date; createdBy: string | null; note: string | null; active: boolean }>>`, `rollback(version: number, actor): Promise<{ version: number; settings: AppSettings }>` (copies that version's document as a new version, audit action `settings.rollback`), `seedDefaults(): Promise<void>` (inserts version 1 from `DEFAULT_APP_SETTINGS` when no row exists).
- Routes: `GET /api/settings/public → { podcast: {...durations/episodes/formats user may pick}, media, voicesAvailable }` (no auth, no secrets); `GET /api/admin/settings`, `PUT /api/admin/settings` body `{ patch, note? }`, `GET /api/admin/settings/versions`, `POST /api/admin/settings/rollback` body `{ version }`.

- [ ] **Step 1: Write failing tests** — service: `seedDefaults creates version 1 equal to DEFAULT_APP_SETTINGS`; `update merges and creates version 2 and audit row`; `rollback to 1 creates version 3 with version 1 document`; `update rejects invalid patch` (episodes 0 → ZodError); `concurrent updates keep one active version` (`Promise.all` of 5 updates → versions 2..6 distinct, exactly one active). Routes: `public settings exposes no bugReports email`; `admin can update and read back`.
- [ ] **Step 2: Run** tests — Expected: FAIL.
- [ ] **Step 3: Implement** service (transaction with `SELECT ... FOR UPDATE` on the active row to serialise), routes, mount in `app.ts`.
- [ ] **Step 4: Run** `npm test -w apps/api` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): versioned admin settings with rollback and audit log`.

### Task 6: Brand package — logo and icon generation

**Files:**
- Create: `packages/brand/package.json` (`@thinkmade/brand`), `packages/brand/README.md` (concept, usage rules, sizes tested), `packages/brand/src/symbol.svg`, `packages/brand/src/wordmark.svg`, `packages/brand/src/logo-horizontal-light.svg`, `packages/brand/src/logo-horizontal-dark.svg`, `packages/brand/src/logo-stacked-light.svg`, `packages/brand/src/logo-stacked-dark.svg`, `packages/brand/src/logo-mono.svg`, `packages/brand/src/app-icon.svg` (symbol on Terracotta rounded square), `packages/brand/src/app-icon-maskable.svg` (symbol centred within the 80% safe zone), `packages/brand/src/social-card.svg` (1200×630 with name and tagline), `packages/brand/scripts/build-icons.ts`
- Generated into: `apps/web/public/brand/*.svg`, `apps/web/public/icons/icon-{48,72,96,128,144,192,256,384,512}.png`, `apps/web/public/icons/maskable-{192,512}.png`, `apps/web/public/apple-touch-icon.png` (180), `apps/web/public/favicon.svg`, `apps/web/public/favicon-32.png`, `apps/web/public/favicon-16.png`, `apps/web/public/social-card.png`
- Test: `packages/brand/scripts/build-icons.test.ts`

**Interfaces:**
- Produces: `npm run build:icons -w packages/brand` renders every PNG above with `@resvg/resvg-js` and writes a `manifest-icons.json` listing `{ src, sizes, type, purpose }` entries that `apps/web` imports into the PWA manifest.
- Design brief (locked here): monoline symbol, one continuous stroke, no gradients, no brain or circuit imagery. Concept: a "thinking fingerprint" — three concentric open arcs (ridges) that resolve into a single rising path ending in a solid dot (insight). Stroke colour Deep Charcoal on light, Warm Ivory on dark, Warm Ivory on the Terracotta app icon. Wordmark: a humanist sans (system stack `"Inter", "SF Pro Text", system-ui`) with `Think` regular weight and `Made` semibold, letter-spacing −0.01em.

- [ ] **Step 1: Write failing test** — `build-icons.test.ts`: `renders every required size and the maskable variants` (run the build into a temp dir; assert each listed file exists and the PNG header reports the right width); `maskable icon keeps the symbol inside the safe zone` (sample the 10% border ring of `maskable-512.png`: all pixels equal the Terracotta background).
- [ ] **Step 2: Run** `npm test -w packages/brand` — Expected: FAIL.
- [ ] **Step 3: Design** the SVG sources; open each in the built-in browser at 32/48/64/128/180/192/512 px side by side and adjust stroke weight until the symbol stays legible at 32 px; write `build-icons.ts`.
- [ ] **Step 4: Run** `npm test -w packages/brand && npm run build:icons -w packages/brand` — Expected: PASS and files generated.
- [ ] **Step 5: Commit** `feat(brand): ThinkMade logo system and icon generation`.

### Task 7: Web app shell, design system, PWA and auth screens

**Files:**
- Create: `apps/web/package.json` (`@thinkmade/web`), `apps/web/vite.config.ts` (React, Tailwind, VitePWA `registerType: 'prompt'`, manifest from `BRAND` + `manifest-icons.json`, dev proxy `/api` → `http://localhost:8787`), `apps/web/tsconfig.json`, `apps/web/index.html` (title, meta description, theme-color, apple-mobile-web-app-capable, viewport-fit=cover, social meta tags), `apps/web/src/main.tsx`, `apps/web/src/app.tsx` (router), `apps/web/src/styles/tokens.css` (Tailwind `@theme` with the five brand colours plus derived surfaces, dark overrides under `prefers-color-scheme` and `[data-theme]`, spacing, radius, type scale), `apps/web/src/styles/global.css`
- Create components: `apps/web/src/components/app-shell.tsx`, `bottom-nav.tsx`, `top-bar.tsx` (logo + avatar menu: Profile, Settings, Help, Report a Bug, Admin when role admin, Sign out), `install-prompt.tsx` (Chromium `beforeinstallprompt`; iOS sheet with Add to Home Screen steps; hidden in standalone), `update-prompt.tsx` (uses `useRegisterSW`; shows "Update available" and applies only on tap), `button.tsx`, `input.tsx`, `sheet.tsx`, `logo.tsx`
- Create screens: `apps/web/src/screens/create.tsx` (prompt, textarea, mic/photo/video buttons disabled with "available in a later release" tooltips, `Create My Podcasts` → shows honest notice "Podcast generation arrives in the next release", `Customize` disclosure), `discover.tsx` (placeholder search with "Public podcasts arrive in a later release"), `library.tsx` (empty state), `sign-in.tsx`, `sign-up.tsx`, `verify-email.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `settings.tsx` (profile name, passkeys list/add/remove, two-factor enable with QR, delete account, export data link), `admin/settings.tsx` (JSON-schema-free form for the podcast defaults + versions list + rollback), `help.tsx`, `report-bug.tsx` (form posts to `/api/bug-reports`; until Phase 9 the API returns 501 and the UI shows "Bug reporting is not wired up yet")
- Create: `apps/web/src/lib/auth-client.ts` (Better Auth React client with passkey, twoFactor, admin client plugins), `apps/web/src/lib/api.ts` (fetch wrapper with credentials), `apps/web/src/lib/use-session.ts`
- Test: `apps/web/src/components/bottom-nav.test.tsx` (Vitest + Testing Library), `apps/web/e2e/shell.spec.ts`, `apps/web/e2e/auth.spec.ts`, `apps/web/playwright.config.ts` (projects: `iPhone 14`, `Pixel 7`, desktop Chrome; webServer starts API on PGlite and Vite)

**Interfaces:**
- Consumes: `/api/auth/*`, `/api/me`, `/api/settings/public`, `/api/admin/settings*` from Tasks 3–5.
- Produces: route table `/`, `/discover`, `/library`, `/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/settings`, `/help`, `/report-bug`, `/admin/settings`.

- [ ] **Step 1: Write failing tests** — unit: `bottom nav renders exactly Create, Discover, My Library`. e2e `shell.spec.ts` (iPhone 14 project): `landing shows name, tagline and purpose` (texts from Global Constraints visible); `no horizontal overflow on phone` (`document.documentElement.scrollWidth <= window.innerWidth` on `/`, `/sign-in`, `/settings`); `bottom nav items are at least 44px tall`; `manifest is served with ThinkMade name and 512 maskable icon`. e2e `auth.spec.ts`: `sign up, verify via captured email, sign in, see Create` (test API exposes `GET /api/_test/last-email` only when `NODE_ENV=test`); `unverified user sees verification notice`; `passkey button hidden without WebAuthn` (evaluate with `window.PublicKeyCredential` deleted via `addInitScript`).
- [ ] **Step 2: Run** `npm test -w apps/web && npx playwright test` — Expected: FAIL.
- [ ] **Step 3: Implement** the app. Verify visually in the built-in browser at 375×812 (light and dark) before moving on.
- [ ] **Step 4: Run** unit + e2e — Expected: PASS. Run Lighthouse PWA audit on the production build (`vite preview`) — installability checks pass.
- [ ] **Step 5: Commit** `feat(web): app shell, design system, PWA and account screens`.

### Task 8: Vercel configuration and deployment documentation

**Files:**
- Create: `vercel.json` (`buildCommand: npm run build -w packages/brand -w apps/web`, `outputDirectory: apps/web/dist`, `framework: vite`, `rewrites: [{ source: '/api/(.*)', destination: '/api/index' }, { source: '/((?!api/).*)', destination: '/index.html' }]`, headers for `/assets/*` immutable cache and `sw.js` no-cache), `api/index.ts` (`import { handle } from 'hono/vercel'`; builds the context once per instance; `export default handle(app)`), `docs/deployment.md` (Vercel project setup, env vars, custom domain `thinkmade.zicaworld.com` → CNAME to the project-specific `*.vercel-dns-*.com` value shown in the Vercel dashboard, Hobby-plan fair-use note, Neon and R2 setup, worker deployment pointer), `docs/free-tier-limits.md` (table from design §6)
- Test: `apps/api/src/vercel-entry.test.ts`

- [ ] **Step 1: Write failing test** — `vercel entry handles a health request` (import `api/index.ts` default export with a `Request('http://x/api/health')` → 200 JSON).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** entry, `vercel.json`, docs. Run `npx vercel build` locally (no login needed for build) — Expected: builds without error.
- [ ] **Step 4: Run** test and `npx vercel build` — Expected: PASS.
- [ ] **Step 5: Commit** `chore: vercel configuration and deployment docs`.

### Task 9: Developer experience, CI and Phase 1 report

**Files:**
- Create: `.github/workflows/ci.yml` (Node 26; `npm ci`; lint; typecheck; unit tests; Playwright on Chromium; `npm audit --audit-level=high`; gitleaks action), `README.md` (quick start: `npm install`, `npm run dev`, URLs, test commands), `scripts/dev.ts` (starts API on PGlite with `concurrently` alongside Vite), `scripts/seed-admin.ts` (`npm run seed:admin -- email` promotes a user to admin after verifying they exist)
- Modify: `docs/ROADMAP.md` (tick verified items), add `docs/reports/phase-1.md`
- Test: `apps/api/src/env.test.ts` addition `boots without env`

- [ ] **Step 1: Write failing test** — `boots without env` (`createContext({ env: loadEnv({}) })` resolves, health route 200, `AUTH_SECRET` warning logged once).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** scripts, CI, README; run the full suite locally exactly as CI will.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test && npx playwright test` — Expected: all PASS. Push and confirm the GitHub Actions run is green.
- [ ] **Step 5: Write** `docs/reports/phase-1.md` (features completed, tests performed, not completed, known issues, security considerations, infrastructure dependencies, next steps) and tick `docs/ROADMAP.md`. Commit `docs: phase 1 report`.
