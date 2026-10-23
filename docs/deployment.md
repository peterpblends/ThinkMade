# Deploying ThinkMade

ThinkMade deploys as one Vercel project. It serves the PWA as static files and one Node function for every `/api` route. Podcast generation runs on a separate worker from Phase 2 onward, described below.

Nothing here has been deployed yet. Every step below needs the owner's accounts.

## 1. What the build produces

`npm run build:vercel` builds the web app and writes Vercel's Build Output API v3 directory to `.vercel/output`:

| Path | Contents |
|---|---|
| `static/` | The built PWA, service worker, icons and manifest |
| `functions/api.func/` | The bundled API as `index.mjs`, its migrations and `.vc-config.json` (Node 22 runtime) |
| `config.json` | Routing, security headers, the SPA fallback, and a CSP that allows only the hashed inline theme script |

`vercel.json` tells Vercel to run that command. Vercel then serves `.vercel/output` as is.

## 2. Accounts to create

| Service | Purpose | Plan |
|---|---|---|
| Vercel | Web app and API | Hobby. This is the owner's decision, recorded on 2026-10-22. See the plan note below. |
| Neon | Postgres with pgvector | Free plan, no card required |
| Cloudflare R2 | Audio and uploads, from Phase 2 | Free tier. Cloudflare may ask for a payment method on file. |
| Resend or Brevo | Verification, password reset and bug-report email | Free tier |

## 3. Database (Neon)

1. Create a Neon project in the region closest to your users, for example AWS us-east-1.
2. Copy the pooled connection string. It looks like `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
3. Apply migrations from your machine. This also enables pgvector.

```bash
DATABASE_URL='postgresql://…' npm run db:migrate
```

Run it again after any deploy whose commit adds files under `packages/db/migrations`. Production functions never migrate on start-up.

## 4. Vercel project

1. In Vercel, choose **Add New → Project** and import `peterpblends/ThinkMade`.
2. Leave **Root Directory** at the repository root and **Framework Preset** at *Other*. `vercel.json` sets the commands.
3. Add these environment variables for Production and Preview:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | Output of `openssl rand -base64 32`. Keep it secret and never reuse it. |
| `APP_URL` | `https://thinkmade.zicaworld.com`, Production only |
| `GROQ_API_KEY` | Groq key: Coach Me and voice transcription run in the API |
| `OPENROUTER_API_KEY` | Optional here (the worker uses it for photos); lets **Admin → AI models → Test** check the vision model |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | The same R2 values the worker uses (section 6a) |
| `EMBED_SERVER_URL` | `https://embed.zicaworld.com/v1`, the worker's embedding server (`worker.md`, "Search embeddings"). Without it, Discover uses text search only. |
| `EMBED_SERVER_TOKEN` | The same token as the worker's `EMBED_SERVER_TOKEN` |

Leave `APP_URL` unset for Preview. Each preview deployment derives its own address from Vercel's `VERCEL_URL`, so sign-in works on every preview. `API_URL` defaults to `APP_URL`. `PASSKEY_RP_ID` defaults to the host name of `APP_URL`. In production, the API refuses to start without `APP_URL`, so it can never fall back to localhost.

The build downloads the on-device speech model (Moonshine base, about 67 MB, checked by SHA-256) and serves it from `/speech`, so listeners' phones never contact a third party. Set `SKIP_SPEECH_MODEL=1` to leave it out; voice input then always uses Groq.

Production builds apply database migrations to Neon before going live (preview builds never touch the database), so there's no separate migration step.

4. Deploy. Then check that `https://<deployment>/api/health` returns `{"ok":true,…,"db":"pg"}`.

## 5. Custom domain: thinkmade.zicaworld.com

This adds one subdomain. It does not touch `zicaworld.com` or any other record.

1. In the Vercel project, open **Settings → Domains → Add** and enter `thinkmade.zicaworld.com`.
2. Vercel then shows the exact record to create. For a subdomain it is a **CNAME** record:

| Type | Name | Value |
|---|---|---|
| CNAME | `thinkmade` | The project-specific target Vercel shows, such as `xxxxxxxxxxxxxxxx.vercel-dns-017.com` |

Use the value from the dashboard. Each project has its own, so don't copy one from documentation.

3. Add the record wherever DNS for `zicaworld.com` is managed. Change nothing else. Leave existing A, MX and TXT records exactly as they are.
4. If `zicaworld.com` belongs to a different Vercel team, Vercel also asks for a **TXT** record at `_vercel.zicaworld.com` to prove access. Add that as well.
5. Wait for Vercel to show **Valid Configuration**. It then issues the HTTPS certificate automatically.

## 6. Email

Set `RESEND_API_KEY` or `BREVO_API_KEY`, and `EMAIL_FROM`.

- **Resend.** Add the DNS records Resend shows for `zicaworld.com`. These are new TXT and MX records on a subdomain such as `send.zicaworld.com`, so they don't affect existing mail.
- **Brevo.** Verify the single sender address instead; no DNS changes are needed.

In production with no provider configured, every email is recorded as failed in the admin Overview, and sign-ups cannot be verified. The app never pretends an email was sent.

## 6a. Cloudflare R2 CORS and the content security policy

Set `S3_ENDPOINT` as a Vercel environment variable for both build and runtime. The build adds that origin to the content security policy's `connect-src`, which is what lets browsers upload to R2 and download from it.


Downloads for offline listening fetch audio from the browser through a presigned R2 URL, so the bucket needs a CORS rule. In the R2 bucket's **Settings**, open **CORS policy** and allow `GET` and `HEAD` from `https://thinkmade.zicaworld.com`. Large photo and video uploads go straight to R2 too, so also allow `PUT` with the `content-type` header.

## 7. Vercel plan note

Vercel's Fair Use Guidelines, updated 2026-09-14, limit the Hobby plan to non-commercial personal use. Commercial use means any deployment "used for the purpose of financial gain of anyone involved in any part of the production of the project". The owner chose Hobby for launch. If Vercel decides the project is commercial, it can pause deployments, and moving to Pro ($20 per member per month) resolves that. Section 6 of the architecture design records this risk.

## 8. Worker

See [worker.md](worker.md). It runs on the Oracle Cloud Always Free VM in Docker and needs no inbound ports.

## 9. First administrator

Sign up on the live site and verify your email. Then promote yourself from your machine:

```bash
DATABASE_URL='postgresql://…' npm run seed:admin -- you@example.com
```

Then turn on two-step verification in **Settings**. Admin tools stay closed until you do.

## 10. Local development

```bash
npm install
npm run dev
```

This starts the API on http://localhost:8787 with an embedded database in `.data/pglite`, and the app on http://localhost:5173. Emails print in the API terminal. To make yourself an admin, sign up first, then run `npm run seed:admin -- you@example.com`.
