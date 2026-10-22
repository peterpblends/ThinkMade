# Running the podcast worker

The worker does all the long work, so Vercel's request time limits never matter:

- reading photos and videos
- research and book verification
- planning and scripts
- the quality review
- Kokoro speech
- ffmpeg assembly

It claims jobs from the `generation_job` table in Postgres and makes only outbound connections.

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

The first episode downloads the Kokoro voice model, about 90 MB, into the `thinkmade-models` volume.

## Environment (`worker.env`)

| Variable | Value |
|---|---|
| `DATABASE_URL` | The same Neon connection string the API uses |
| `GROQ_API_KEY` | Groq key, for the language model and video transcription |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Your R2 bucket name |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | An R2 API token scoped to that bucket |
| `S3_REGION` | `auto` |
| `KOKORO_DTYPE` | `q8` (default). `fp32` sounds slightly better and runs about 2× slower. |

Optional:

- `OLLAMA_BASE_URL` for a self-hosted model.
- `DEFAULT_LLM_PROVIDER` and `DEFAULT_LLM_MODEL` to seed different defaults. The admin dashboard is the usual place to change models.

## Throughput on this hardware

Kokoro measured 0.48× real time on an M2 Pro. On 2 ARM cores, expect roughly 1× real time, so a 15-minute episode takes about 15 minutes of speech synthesis. The admin setting **Concurrent generations** caps parallel jobs; 1 or 2 suits this VM. Jobs queue rather than fail, and progress shows on each user's screen.

## Locally

With no `DATABASE_URL`, `npm run dev` runs the worker inside the API process against the embedded database, so nothing extra is needed.

To try a real end-to-end episode with a local model:

```bash
LIVE_PROVIDER=ollama LIVE_MODEL=qwen2.5:7b npm run live-check -w apps/worker
```
