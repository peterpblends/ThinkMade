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
| `APP_URL` | `https://thinkmade.zicaworld.com` in Production, or the preview URL in Preview |
| `API_URL` | The same value as `APP_URL` |
| `PASSKEY_RP_ID` | `thinkmade.zicaworld.com` in Production |

Preview deployments get a different hostname each time. Passkeys are bound to `PASSKEY_RP_ID`, so they only work on the production domain. Email and password sign-in works everywhere.

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

Until an email provider is configured, the API logs emails to the server console. Production verification emails will not arrive until this step is done. Wiring a provider is tracked in the roadmap, Phase 9.

## 7. Vercel plan note

Vercel's Fair Use Guidelines, updated 2026-09-14, limit the Hobby plan to non-commercial personal use. Commercial use means any deployment "used for the purpose of financial gain of anyone involved in any part of the production of the project". The owner chose Hobby for launch. If Vercel decides the project is commercial, it can pause deployments, and moving to Pro ($20 per member per month) resolves that. Section 6 of the architecture design records this risk.

## 8. Worker (from Phase 2)

The podcast worker runs separately on the Oracle Cloud Always Free Ampere A1 VM, with 2 OCPU and 12 GB. It only makes outbound connections, to Postgres, R2 and the model APIs, so it needs no open inbound ports. Phase 2 adds setup steps here.

## 9. Local development

```bash
npm install
npm run dev
```

This starts the API on http://localhost:8787 with an embedded database in `.data/pglite`, and the app on http://localhost:5173. Emails print in the API terminal. To make yourself an admin, sign up first, then run `npm run seed:admin -- you@example.com`.
