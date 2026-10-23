/**
 * End-to-end check with real providers: language model, Kokoro voices, live book verification.
 * Generates one episode on an in-memory database and writes the MP3, transcript and a report.
 *
 *   LIVE_PROVIDER=ollama LIVE_MODEL=qwen2.5:7b npm run live-check -w apps/worker
 *   LIVE_PROVIDER=groq   LIVE_MODEL=openai/gpt-oss-120b GROQ_API_KEY=... npm run live-check -w apps/worker
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { createKokoroTts, createLlm, createLocalStorage, createStt, verifyBook } from '@thinkmade/ai';
import { createDb, runMigrations, schema, seedModelConfig } from '@thinkmade/db';
import { DEFAULT_APP_SETTINGS } from '@thinkmade/shared';
import { runNextJob } from '../src/index';

const provider = process.env.LIVE_PROVIDER ?? 'ollama';
const model = process.env.LIVE_MODEL ?? 'qwen2.5:7b';
const minutes = Number(process.env.LIVE_MINUTES ?? 5);
const topic = process.env.LIVE_TOPIC ?? 'Why do projects in my small team always run late, and how should I think about fixing it?';
const out = resolve(process.env.LIVE_OUT ?? '.data/live-check');
mkdirSync(out, { recursive: true });

const t0 = Date.now();
const h = await createDb({ pgliteDir: ':memory:' });
await runMigrations(h);
await h.db.insert(schema.appSetting).values({ name: 'app', version: 1, document: DEFAULT_APP_SETTINGS as never, active: true });
await h.db.insert(schema.user).values({ id: 'live', name: 'Live check', email: 'live@example.com', emailVerified: true });
await seedModelConfig(h.db, { provider, model });
const storage = createLocalStorage(join(out, 'store'));
const [req] = await h.db.insert(schema.learningRequest).values({ userId: 'live', inputText: topic, learningMode: 'explore' }).returning();
const s = DEFAULT_APP_SETTINGS;
await h.db.insert(schema.generationJob).values({
  userId: 'live',
  learningRequestId: req!.id,
  options: {
    lengthMinutes: minutes, episodes: 1, speakerFormat: 'two_hosts', learningMode: 'explore', visibility: 'private', language: 'en',
    teachingStyle: s.podcast.teachingStyle, voices: { single: s.voices.single, hostA: s.voices.hostA, hostB: s.voices.hostB },
    bitrateKbps: 64, maxTokens: s.limits.maxTokensPerJob, maxAudioMinutes: s.limits.maxAudioMinutesPerJob, quality: s.quality,
  } as never,
});
await runNextJob({
  db: h.db,
  llm: async () => createLlm({ provider, model }, process.env),
  tts: createKokoroTts({ dtype: 'q8' }),
  stt: createStt(process.env),
  storage,
  verifyBook: (c) => verifyBook(c),
  workDir: join(out, 'work'),
  workerId: 'live-check',
  leaseSeconds: 3600,
  log: (m, x) => console.info('[worker]', m, JSON.stringify(x ?? {})),
});
const [j] = await h.db.select().from(schema.generationJob);
const eps = await h.db.select().from(schema.episode);
const report = {
  provider, model, minutesTaken: Number(((Date.now() - t0) / 60000).toFixed(1)), status: j!.status, error: j!.error, tokens: j!.tokensUsed,
  mentalModels: (await h.db.select().from(schema.mentalModel)).map((m) => m.name),
  verifiedSources: (await h.db.select().from(schema.source)).map((x) => x.title),
  episodes: eps.map((e) => ({ title: e.title, status: e.status, measuredSeconds: e.durationSeconds, plannedMinutes: e.plannedMinutes, words: (e.transcript ?? '').split(/\s+/).length, outcomes: e.outcomes })),
  qualityChecks: (await h.db.select().from(schema.episodeQualityCheck)).map((c) => ({ revision: c.revision, passed: Boolean(c.passed), scores: c.scores, notes: c.notes })),
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const ep = eps[0];
if (ep?.transcript) writeFileSync(join(out, 'transcript.txt'), ep.transcript);
if (ep?.audioKey) writeFileSync(join(out, 'episode.mp3'), await buffer((await storage.get(ep.audioKey)).stream));
console.info(JSON.stringify(report, null, 2));
await h.close();
