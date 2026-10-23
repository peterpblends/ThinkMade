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

## On the Oracle Cloud Always Free VM (recommended)

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
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Your R2 bucket name |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | An R2 API token scoped to that bucket |
| `S3_REGION` | `auto` |
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
