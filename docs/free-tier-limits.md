# Free-tier limits that affect ThinkMade

These figures were checked on 2026-10-22 against each provider's pricing page, or reputable reporting where noted. Providers change free tiers without notice, so check again before relying on them.

| Service | Free allowance | Where ThinkMade will feel it |
|---|---|---|
| **Vercel Hobby** | 100 GB transfer, 1M function invocations, 4 h active CPU, 360 GB-h memory per month | Non-commercial use only, see `deployment.md`. Audio streams from R2, not Vercel, so transfer stays small. API CPU is light. Coaching calls are the biggest consumer. |
| **Neon Free** | 1 GB per project, 100 compute-hours per month, suspends after 5 min idle | The first request after idle waits about 1 s while compute wakes. 1 GB holds metadata and transcripts for thousands of episodes, but not audio. |
| **Cloudflare R2** | 10 GB storage, 1M writes, 10M reads per month, free egress | Holds about 170 hours of 128 kbps MP3. Retention rules and audio reuse keep it inside the limit. |
| **Oracle Always Free (A1)** | 2 OCPU and 12 GB RAM, halved in June 2026 according to InfoQ | Kokoro speech runs at roughly 0.5–0.65× real time on 4 x86 cores, and slower on 2 ARM cores. A 60-minute episode may take 45–60 min of CPU. Jobs queue rather than fail. |
| **Groq Free** | About 30 requests/min and about 1,000 requests/day on 70B-class models, according to third-party summaries | Caps generation at roughly 50–100 episodes per day across all users. The admin dashboard and quotas guard it. |
| **Resend Free** | 3,000 emails/month, 100/day | Verification and reset emails stop for the rest of the day after 100. ThinkMade reports the failure instead of claiming success. |

## Alerts

The admin dashboard, built in Phase 9, will warn when any tracked metric passes 80% of its allowance. Nothing upgrades to a paid plan automatically.
