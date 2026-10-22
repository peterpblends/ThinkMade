# ThinkMade

**Better Thinking. Made Personal.**

ThinkMade turns the world's best books and mental models into personalized podcasts. They teach you how to think through whatever you're trying to learn or solve.

> Status: Phase 1 (Foundation) of 10. Accounts, the mobile app shell, branding, admin defaults and deployment configuration work. Podcast generation starts in Phase 2. See [docs/ROADMAP.md](docs/ROADMAP.md) and the latest [phase report](docs/reports/phase-1.md).

## Quick start

You need Node 22 or newer. The repository pins Node 26 in `.nvmrc`. You don't need Docker, Postgres or any accounts to develop locally.

```bash
npm install
npm run dev
```

- App: http://localhost:5173 (the API is proxied under `/api`)
- API: http://localhost:8787, using an embedded Postgres (PGlite with pgvector) in `apps/api/.data`
- Emails, such as verification links, print in the terminal

Make yourself an administrator. First sign up and verify, then stop `npm run dev` and run:

```bash
npm run seed:admin -- you@example.com
```

Admin tools also require two-step verification, which you can turn on in **Settings**.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API and web app with reload |
| `npm test` | Unit and integration tests for every package |
| `npm run e2e` | Playwright on iPhone, Pixel and desktop profiles, against a production build |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run build:vercel` | Builds the deployable `.vercel/output` |
| `npm run build:icons` | Regenerates every logo and icon from `packages/brand/src/logo.ts` |
| `npm run db:migrate` | Applies migrations to `DATABASE_URL` (deploy step) |

## Layout

```
apps/web        React PWA (Vite, Tailwind, Workbox)
apps/api        Hono API, Better Auth, settings and admin. Runs on Node locally and as one Vercel function.
packages/db     Drizzle schema, migrations, Postgres/PGlite client
packages/shared Brand constants, settings schema and defaults
packages/ai     Provider adapters (email now; LLM, speech, vision from Phase 2)
packages/brand  Logo system and icon generation
docs/           Spec, architecture, roadmap, deployment, free-tier limits, phase reports
```

## Documentation

- [Master build specification](docs/MASTER-BUILD-SPEC.md)
- [Architecture design](docs/superpowers/specs/2026-10-22-thinkmade-architecture-design.md)
- [Deployment](docs/deployment.md) and [free-tier limits](docs/free-tier-limits.md)
- [Brand guide](packages/brand/README.md)
