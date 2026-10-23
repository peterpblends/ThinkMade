# Third-party licences worth knowing

ThinkMade uses only free and open-source software and free service tiers. These are the components whose licences matter for distribution or attribution.

| Component | Licence | How ThinkMade uses it | Notes |
|---|---|---|---|
| Phonon-31M (gradium/phonon-31m-en), its voices (gradium/phonon-voices) and phonon-tts | Apache-2.0; runtime MIT OR Apache-2.0 | Default speech synthesis in the worker | Commercial use allowed. Don't use the CC BY-NC Phonon 40M models. Phonon's model card asks that listeners be told speech is synthetic; the Help page says so. |
| Kokoro-82M voice model and kokoro-js | Apache-2.0 | Backup speech synthesis in the worker | Commercial use allowed |
| EmbeddingGemma 2 (onnx-community/embeddinggemma-2-ONNX) | Apache-2.0 | Search vectors in the worker | |
| Moonshine base (onnx-community/moonshine-base-ONNX) | MIT | Optional on-device voice input in the browser | Served by ThinkMade from `/speech` |
| ffmpeg (via ffmpeg-static) | GPL-3.0-or-later binary | Runs as a separate program in the worker to assemble audio and read media | Not linked into ThinkMade's code and not distributed to users. If you ever ship the worker image to others, include ffmpeg's licence and source offer. |
| Transformers.js and ONNX Runtime | Apache-2.0 and MIT | Run Kokoro, EmbeddingGemma 2 and Moonshine | |
| sharp (libvips) | Apache-2.0 (LGPL libvips binaries) | Pulled in by Transformers.js; not called by ThinkMade | Pinned to 0.35.5 for security fixes |
| Newsreader font | SIL Open Font License 1.1 | Wordmark and headings | Outlined into the logo SVGs |
| Inter font | SIL Open Font License 1.1 | Interface text | |
| opentype.js | MIT | Outlines the wordmark at build time | |
| Better Auth and passkey plugin | MIT | Accounts, passkeys, two-step verification, admin roles | |
| Hono, React, React Router, TanStack Query, Dexie, Drizzle, Zod, Tailwind CSS, Vite, vite-plugin-pwa, Workbox, lucide-react | MIT or ISC | Application framework | lucide icons are ISC |
| PGlite and pgvector | Apache-2.0 / PostgreSQL | Embedded development database and vector search | |
| Open Library data | Open data (CC0 for most records) | Book verification | Please send a descriptive User-Agent (done) |
| Google Books API | Google APIs Terms of Service | Fallback book verification | Keyless use has low quotas |

## Model outputs

Episodes are written by the language models configured by administrators: by default Qwen3.8-27B (Apache-2.0) and gpt-oss-120b/20b (Apache-2.0) on Groq, and Gemma 4 (Apache-2.0) on OpenRouter for images. Check the provider's terms for the models you choose. ThinkMade's prompts tell models to explain ideas in their own words and never to reproduce book text.
