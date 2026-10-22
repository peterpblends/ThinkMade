# Third-party licences worth knowing

ThinkMade uses only free and open-source software and free service tiers. These are the components whose licences matter for distribution or attribution.

| Component | Licence | How ThinkMade uses it | Notes |
|---|---|---|---|
| Kokoro-82M voice model and kokoro-js | Apache-2.0 | Speech synthesis in the worker | Commercial use allowed |
| ffmpeg (via ffmpeg-static) | GPL-3.0-or-later binary | Runs as a separate program in the worker to assemble audio and read media | Not linked into ThinkMade's code and not distributed to users. If you ever ship the worker image to others, include ffmpeg's licence and source offer. |
| Transformers.js and ONNX Runtime | Apache-2.0 and MIT | Run Kokoro | |
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

Episodes are written by the language model configured by administrators (Groq-hosted open models by default). Check the provider's terms for the models you choose. ThinkMade's prompts tell models to explain ideas in their own words and never to reproduce book text.
