# Running the podcast worker

The worker does all the long work, so Vercel's request time limits never matter:

- reading photos and videos
- research and book verification
- planning and scripts
- the quality review
- Phonon speech (Kokoro if Phonon can't run)
- search embeddings (EmbeddingGemma 2)
- ffmpeg assembly

It claims jobs from the `generation_job` table in Postgres. It makes only outbound connections unless you turn on the optional embedding server below.

## Quality review and recovery

**Before any audio is made**, every script is reviewed: automatic checks (length, stock phrases, one host doing all the talking, markdown or stage directions that would be read aloud, repetition) and a language-model review that scores it against the episode's goals. A script that fails is fixed before it is voiced:

1. The sections the review marked weak are rewritten with the reviewer's notes, up to **Section rewrites per draft** times (Admin → Settings → Quality, default 2).
2. If it still fails, the whole episode is written again from scratch, told everything the failed drafts were marked down for, up to **Fresh drafts of the whole episode** times (default 2). Each fresh draft gets its own rewrites.
3. Only a script that fails all of that is held for a person to review in Admin → Quality. It is never voiced.

**Token allowances.** Each episode has its own language-model allowance, by its length (40,000 tokens plus 8,000 a minute: 160,000 for 15 minutes). When an episode reaches it, it stops polishing: it is recorded if its script passes the automatic checks, and held for review otherwise. A budget never stops the rest of the series. Admin → Settings → *Language model tokens per generation* is a series-wide cap on top, but it never leaves an episode less than its own allowance. A restarted or regenerated podcast starts with fresh allowances.

**When something errors partway**, only the step that failed is started over:

- Each step (a section of script, a review, an episode's audio) is retried in place twice, a few seconds apart. Everything finished before it is kept.
- If it still fails, the job is retried later (after 15 and 30 seconds), carrying on from its saved progress.
- The scheduled check (every 3 hours) resumes podcasts that were waiting; if the check itself can't reach the database, it runs the worker anyway.
- When those retries are used up, the job starts again on its own after 5 minutes, and once more after an hour, from the step that failed. Only then is the podcast marked as errored (an admin can still restart it).
- Usage limits wait for the provider's allowance instead (up to a day and a half), and a rejected API key or missing configuration fails at once, since retrying can't fix them.
- Voicing another language retries an episode that errors once, without translating it again, before marking it failed.

## Where to run it (all free)

| Option | Card needed | Always available | Limits |
|---|---|---|---|
| **GitHub Actions** (on demand) | No | Yes | 2,000 free minutes a month on a private repository, roughly 40 three-episode series. Unlimited if the repository is public. |
| **Your Mac** | No | Only while it's on and awake | None |
| **Oracle Cloud Always Free VM** | Yes, for identity verification only (Always Free resources aren't charged) | Yes | 2 OCPU, 12 GB |

You can run more than one: workers share the queue safely.

## On GitHub Actions (no card)

The workflow `.github/workflows/worker.yml` drains the queue and exits. The API starts a run whenever someone creates a podcast, and every 3 hours a quick check (under a minute) starts a run only if a job is due, such as one that waited out a rate limit.

1. The workflow is already on `main`; nothing to push.
2. Add the secrets. Either run `npm run worker:github-secrets` on your Mac (copies `.env.worker`; needs `gh auth login`), or in GitHub, **Settings → Secrets and variables → Actions → New repository secret**, add: `DATABASE_URL`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` (recommended backup), `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and optionally `RESEND_API_KEY`, `EMAIL_FROM`). Use the same values as in Vercel.
3. Create a fine-grained GitHub token (**Settings → Developer settings → Fine-grained tokens**) for the ThinkMade repository only, with **Contents: Read and write** (needed to start workflow runs). In Vercel, add `WORKER_DISPATCH_REPO=peterpblends/ThinkMade` and `WORKER_DISPATCH_TOKEN=<token>` (Sensitive), then redeploy.
4. Test it: **Actions → Worker → Run workflow**. The log ends with `queue drained`.

### Podcasts in other languages

Listeners can make podcasts in Spanish, French, Portuguese (Brazil), Italian and Hindi (Admin → Defaults → Features → Other languages). Scripts are written in that language by the same language models, and Kokoro's native voices speak them: Spanish (Dora, Alejandro, with Latin American pronunciation), French (Camille), Italian (Sara, Nicola), Portuguese (Beatriz, Rafael) and Hindi (Priya, Anika, Arjun, Rohan). French has one voice, so French podcasts have a single host. The worker turns text into each language's sounds with eSpeak NG (the `espeak-ng` package, GPL-3.0); it runs only in the worker, never in the app. Japanese and Mandarin aren't offered: Kokoro needs tools for them that don't run here.

The owner of a finished podcast can switch its language from the series page. The text (titles, descriptions, what you'll learn) is translated at once by the API and shown straight away; a background job (`options.translate`) then translates each script and voices it with that language's native voices, keeping the hosts' names. Each episode plays in the original language until its new audio is ready, and switching back to a language the podcast already has is instant. Translations live in `series_translation` and `episode_translation`; `podcast_series.language` is the language shown to everyone, `original_language` the one it was made in. A podcast needs a voice per host in the new language (French, with one voice, only suits single-host podcasts).

### Voice samples

Listeners can play a short sample of each voice when picking voices on the Create page. After each run, the worker renders samples for voices that don't have one yet (and for voices an administrator adds later) and stores them in object storage with a `manifest.json` the API reads. To render them all at once, run **Actions → Voice samples → Run workflow** (`npm run voice-samples -w apps/worker` does the same locally with the worker's settings). Until a voice has a sample, its play button simply doesn't appear. Tick **check** when running the workflow to have each sample transcribed and see how much of the sentence came through for every voice (a quick way to spot a voice that doesn't speak clear English). The accent voices (Latino, South Asian, East Asian) all passed this check on 2026-11-02; they are only cast automatically once an administrator ticks **Cast** for them in Admin → Defaults (voice casting) after listening; listeners can always choose them.

## On your Mac (no card)

1. `cp .env.worker.example .env.worker` and fill it in with the same values as in Vercel. It's git-ignored.
2. `npm run worker:mac -- install`. The worker starts now, at every login, and restarts if it stops. Jobs wait in the queue while the Mac sleeps.
3. Check it with `npm run worker:mac -- status`; remove it with `npm run worker:mac -- uninstall`.

## On the Oracle Cloud Always Free VM

1. Create an Ampere A1 instance with 2 OCPU, 12 GB and Ubuntu 24.04. In the Oracle console, leave inbound rules at SSH only.
2. Install Docker on it:

```bash
sudo apt-get update && sudo apt-get install -y docker.io git && sudo usermod -aG docker $USER
```

3. Clone the repository and build the image (about 10 minutes):

```bash
git clone https://github.com/peterpblends/ThinkMade.git && cd ThinkMade && docker build -f apps/worker/Dockerfile -t thinkmade-worker .
```

4. Create `worker.env` with the variables below. Keep it readable only by you (`chmod 600 worker.env`).
5. Start the worker. It restarts automatically after reboots:

```bash
docker run -d --restart unless-stopped --env-file worker.env -v thinkmade-models:/models --name thinkmade-worker thinkmade-worker
```

6. Watch the first job:

```bash
docker logs -f thinkmade-worker
```

The first episode downloads the Phonon voice model (65 MB) and voices, and the first indexing run downloads EmbeddingGemma 2 (about 210 MB). Both are kept in the `thinkmade-models` volume. Kokoro (90 MB) downloads only if Phonon fails.

## Environment (`worker.env`)

| Variable | Value |
|---|---|
| `DATABASE_URL` | The same Neon connection string the API uses |
| `GROQ_API_KEY` | Groq key, for the language models and video transcription |
| `OPENROUTER_API_KEY` | OpenRouter key (free account, no card), for photos and video frames. Groq's free tier has no vision model. |
| `GEMINI_API_KEY` | Recommended. Google AI Studio key (free, no card). Gemini Flash is the backup for every stage, photos included, when Groq or OpenRouter reach their free limits, so podcasts keep being made instead of waiting. |
| `S3_ENDPOINT` | Your B2 endpoint, such as `https://s3.us-west-004.backblazeb2.com` (or an R2 endpoint) |
| `S3_BUCKET` | Your bucket name |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A B2 application key (keyID and applicationKey) scoped to that bucket |
| `S3_REGION` | The B2 region, such as `us-west-004` (`auto` for R2) |
| `TTS_PROVIDER` | Leave unset for Phonon with Kokoro as backup. `kokoro` uses Kokoro only. |
| `KOKORO_DTYPE` | `q8` (default). `fp32` sounds slightly better and runs about 2× slower. |

Optional:

- `OLLAMA_BASE_URL` for a self-hosted model.
- `DEFAULT_LLM_PROVIDER` and `DEFAULT_LLM_MODEL` to use one model for every stage (for example a local Ollama model). Otherwise each stage gets the free defaults in `docs/free-tier-limits.md`. The admin dashboard is the usual place to change models.
- `MODEL_CACHE_DIR` (set to `/models` in the image) for downloaded speech and embedding models.

## Search embeddings (optional server)

The worker indexes public podcasts with EmbeddingGemma 2. The API on Vercel can't run that model, so to embed search queries it calls the worker. Without this, Discover still works, using text matching only.

1. Generate a token: `openssl rand -hex 32`. Add `EMBED_SERVER_PORT=8790` and `EMBED_SERVER_TOKEN=<token>` to `worker.env`. Put the same token in Vercel as `EMBED_SERVER_TOKEN`.
2. Add a DNS **A** record `embed` → the VM's public IP. In the Oracle console, allow inbound TCP 80 and 443 for this VM, and on the VM run `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`.
3. Run the worker with the port published to the VM only, and Caddy in front for HTTPS (certificates are automatic and free):

```bash
docker run -d --restart unless-stopped --env-file worker.env -v thinkmade-models:/models -p 127.0.0.1:8790:8790 --name thinkmade-worker thinkmade-worker
docker run -d --restart unless-stopped --network host -v caddy-data:/data --name caddy caddy:2 caddy reverse-proxy --from embed.zicaworld.com --to 127.0.0.1:8790
```

4. Set `EMBED_SERVER_URL=https://embed.zicaworld.com/v1` in Vercel and redeploy. Check: `curl https://embed.zicaworld.com/health`.

The server accepts only `POST /v1/embeddings` with the bearer token, at most 32 short texts per request. It never sees anything but public podcast text and search queries.

## Throughput on this hardware

Phonon measured about 0.25× real time on one M2 Pro core (4× faster than speech plays). Kokoro measured 0.48×. On 2 ARM cores, expect Phonon at roughly 0.5× real time, so a 15-minute episode takes about 8 minutes of speech synthesis. The admin setting **Concurrent generations** caps parallel jobs; 1 or 2 suits this VM. Jobs queue rather than fail, and progress shows on each user's screen.

## Locally

With no `DATABASE_URL`, `npm run dev` runs the worker inside the API process against the embedded database, so nothing extra is needed.

To try a real end-to-end episode with a local model:

```bash
LIVE_PROVIDER=ollama LIVE_MODEL=qwen2.5:7b npm run live-check -w apps/worker
```

## Listening to sample episodes

**Actions → Samples → Run workflow** renders one short episode per show format (storytelling, conversation and interview) with the real language models and voices, using the worker's secrets. Choose a topic and length, then download the `sample-<format>` artifacts from the finished run. Each has `episode.mp3`, `transcript.txt` and `report.json`, which includes the hosts, the automatic script reviews and the audio checks (lines re-rendered or still suspect). Use it to judge changes to prompts, voices or **Admin → Podcast defaults → Production** by ear.
