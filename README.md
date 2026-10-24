# ThinkMade

**Better Thinking. Made Personal.**

ThinkMade turns the world's best books and mental models into personalized podcasts. They teach you how to think through whatever you're trying to learn or solve.

> **Status: live at https://thinkmade.zicaworld.com.** Email, the first administrator and the podcast worker still need your accounts: see [docs/launch-checklist.md](docs/launch-checklist.md). Real-phone testing and an independent security review are still to do before public promotion.

## What it does

- **Ask.** Type, speak, or show a photo or short video of what you want to learn or solve.
- **Build.** The worker picks the mental models that help, verifies real books about them in Open Library and Google Books, and plans a series. It writes scripts that weave Thinking, Seeing and Doing together, and reviews each script against eight quality criteria. Scripts that fail are rewritten or held for a person. Approved scripts are voiced with Phonon (Kokoro as backup), by one host or two.
- **Listen.** A full player with offline downloads, progress that syncs across devices, favourites, ratings and lock-screen controls.
- **Go further.** Coach Me holds a private, contextual conversation about each episode. Continue Learning offers Explore, Go Deeper, Reinforce or an update. You can also share publicly and discover what others have shared.
- **Run it.** The admin dashboard covers usage and free-tier alerts, AI models per stage, versioned prompts with test runs, a quality review queue, bug reports, people, moderation and an audit log.

## Quick start

You need Node 22 or newer. The repository pins Node 26 in `.nvmrc`. You don't need Docker, Postgres or any accounts to develop locally.

```bash
npm install
npm run dev
```

- App: http://localhost:5173 (the API is proxied under `/api`)
- API: http://localhost:8787, using an embedded Postgres (PGlite with pgvector) in `apps/api/.data`
- Emails, such as verification links, print in the terminal
- To generate podcasts locally, copy `.env.example` to `.env` and set either `GROQ_API_KEY` or `DEFAULT_LLM_PROVIDER=ollama` with a local Ollama model. Without either, generation fails with a clear message saying what's missing.

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
| `npm run live-check -w apps/worker` | Generates one real episode with a real model, Phonon voices and live book checks |

## Layout

```
apps/web        React PWA (Vite, Tailwind, Workbox)
apps/api        Hono API: auth, generation, library, coaching, discovery, admin. Node locally, one Vercel function in production.
apps/worker     Podcast pipeline and durable job queue (Docker; runs in-process locally)
packages/db     Drizzle schema, migrations, Postgres/PGlite client
packages/shared Brand constants, settings schema and defaults
packages/ai     Provider adapters: language models, speech, transcription, vision, embeddings, email, storage, books, media
packages/brand  Logo system and icon generation
docs/           Spec, architecture, roadmap, deployment, free-tier limits, phase reports
```

## Documentation

- [Master build specification](docs/MASTER-BUILD-SPEC.md)
- [Architecture design](docs/superpowers/specs/2026-10-22-thinkmade-architecture-design.md)
- [Deployment](docs/deployment.md), [worker](docs/worker.md) and [free-tier limits](docs/free-tier-limits.md)
- [Acceptance status](docs/acceptance.md), [security assessment](docs/security-assessment.md), [licences](docs/licenses.md)
- [Brand guide](packages/brand/README.md)
