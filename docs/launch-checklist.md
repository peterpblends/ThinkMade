# Launch checklist

Status on 2026-10-24: **https://thinkmade.zicaworld.com is live.** The database (Neon) is migrated, storage (Backblaze B2) is connected with browser access set up, and Groq is configured. These steps remain. Each needs one of your accounts, so they can't be done for you.

## 1. Email, so people can sign up (10 minutes)

Sign-up sends a verification email, and right now no email service is set in Vercel.

1. Create a free account at resend.com.
2. **Domains → Add Domain:** `thinkmade.zicaworld.com`. Add the DNS records Resend shows at GreenGeeks (cPanel → Zone Editor), then click **Verify**.
3. **API Keys → Create API Key**, then copy it.
4. In Vercel (**thinkmade → Settings → Environment Variables**, Production and Preview), add:
   - `RESEND_API_KEY` = the key (Sensitive)
   - `EMAIL_FROM` = `ThinkMade <hello@thinkmade.zicaworld.com>` (must use the verified domain)

## 2. Make yourself the administrator (2 minutes)

1. In Vercel, add `ADMIN_EMAILS` = the address you'll sign up with (Production).
2. After steps 1 and 2, redeploy: **Deployments → … → Redeploy**.
3. Sign up on the site with that address, then click the link in the email. You're now an administrator.
4. In **Settings**, turn on two-step verification. Admin tools open after that.

## 3. Photos and video (5 minutes)

1. Create a free account at openrouter.ai (no card), then **Keys → Create Key**.
2. In **Settings → Privacy**, allow only providers that don't train on or keep your prompts.
3. Use this key as `OPENROUTER_API_KEY` for the worker (step 4).

## 4. Start the podcast worker (pick one; both free, no card)

Nothing generates podcasts until a worker runs. Jobs wait safely in the queue until then.

**Option A: your Mac (quickest)**

```bash
cp .env.worker.example .env.worker
```

Fill in `.env.worker` with the same values as in Vercel, plus `OPENROUTER_API_KEY`. For `DATABASE_URL`, copy the connection string from the Neon console (**Connect**), or from Vercel → **Storage** → your Neon database. Then:

```bash
npm run worker:mac -- install
```

**Option B: GitHub Actions (runs in the cloud, even when your Mac is off).** Follow "On GitHub Actions" in `docs/worker.md`. It starts with:

```bash
gh auth refresh -h github.com -s workflow
```

## 5. First podcast

Create a short podcast (5 minutes, 1 episode) and listen to it. If a stage underperforms, change its model in **Admin → AI models**.

## Optional, later

- **Semantic search:** the worker's embedding server (`docs/worker.md`, "Search embeddings"). Without it, Discover uses text search.
- **Real phones:** test on an iPhone (installed to the home screen) and an Android phone.
- **Independent security review** before public promotion (`docs/security-assessment.md`).
