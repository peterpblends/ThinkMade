# Free-tier limits that affect ThinkMade

These figures were checked on 2026-10-22 (AI providers re-checked 2026-10-23) against each provider's pricing page, or reputable reporting where noted. Providers change free tiers without notice, so check again before relying on them.

| Service | Free allowance | Where ThinkMade will feel it |
|---|---|---|
| **Vercel Hobby** | 100 GB transfer, 1M function invocations, 4 h active CPU, 360 GB-h memory per month | Non-commercial use only, see `deployment.md`. Audio streams from object storage, not Vercel, so transfer stays small. API CPU is light. Coaching calls are the biggest consumer. |
| **Neon Free** | 1 GB per project, 100 compute-hours per month, suspends after 5 min idle | The first request after idle waits about 1 s while compute wakes. 1 GB holds metadata and transcripts for thousands of episodes, but not audio. |
| **Backblaze B2** | 10 GB storage free with no card; downloads free up to 3× the average data stored per month; most API calls free | Holds about 170 hours of 128 kbps MP3. With daily caps set to $0, B2 refuses requests past the free limits rather than billing. Unlimited free downloads are possible through Cloudflare's free CDN. (Cloudflare R2 has free egress but needs a card on file.) |
| **Oracle Always Free (A1)** | 2 OCPU and 12 GB RAM, halved in June 2026 according to InfoQ | Runs Phonon speech, EmbeddingGemma 2 and ffmpeg. Phonon is about 4× faster than real time on one fast core, so expect roughly 2× on this VM: a 60-minute episode takes about 30 min of speech synthesis. Jobs queue rather than fail. |
| **Groq Free** | Per model: 30 requests/min, 1,000 requests/day, 8,000 tokens/min, 200,000 tokens/day (Qwen3.8-27B, gpt-oss-120b, gpt-oss-20b). Whisper: 20 requests/min, 2,000/day. No vision model. Llama 3.3 70B and Llama 4 Scout left the free tier on 2026-08-16. | Each model has its own allowance, so ThinkMade spreads stages across two: gpt-oss-120b (research, plan, script) and gpt-oss-20b (understand, choose models, quality review, Coach Me). Qwen3.8-27B isn't used: some free accounts, including ThinkMade's, cap it at 1,000 output tokens a minute, which a plan or script can't fit in. Scripts use the most tokens, so gpt-oss-120b's 200,000 tokens a day is the main limit: roughly 5–10 fifteen-minute episodes a day across all users. The 8,000 tokens/min limit can make long script sections wait for the next minute; jobs retry with backoff. |
| **OpenRouter Free** | `:free` models: 20 requests/min, and 50 requests/day without credit (1,000/day once an account has bought $10 of credit, which is not required) | Photos and video frames use Gemma 4 31B (`google/gemma-4-31b-it:free`). Each photo or video is one request, so about 50 media inputs a day. Free-model prompts may be logged by the model's host. |
| **Resend Free** | 3,000 emails/month, 100/day | Verification and reset emails stop for the rest of the day after 100. ThinkMade reports the failure instead of claiming success. |

## Models that run on our own hardware (no allowance)

| Model | Licence | Where | Notes |
|---|---|---|---|
| Phonon-31M speech and its 25 English voices | Apache-2.0 | Worker | Default voices. Kokoro-82M (Apache-2.0) is the automatic backup. |
| EmbeddingGemma 2 (q4) | Apache-2.0 | Worker | Search vectors, 512 dimensions |
| Moonshine base (q8) | MIT | Listener's browser, when they turn it on in Settings | About 90 MB once per device, then voice input needs no server |

## Alerts

The admin dashboard, built in Phase 9, will warn when any tracked metric passes 80% of its allowance. Nothing upgrades to a paid plan automatically.
