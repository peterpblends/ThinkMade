/**
 * End-to-end check with real providers: language model, Phonon voices (Kokoro fallback), live book verification.
 * Generates one episode on an in-memory database and writes the MP3, transcript and a report.
 *
 *   LIVE_PROVIDER=ollama LIVE_MODEL=qwen2.5:7b npm run live-check -w apps/worker
 *   LIVE_PROVIDER=groq   LIVE_MODEL=openai/gpt-oss-120b GROQ_API_KEY=... npm run live-check -w apps/worker
 *
 *   LIVE_PROVIDER=stages GROQ_API_KEY=... npm run live-check -w apps/worker   (production's per-stage models and fallbacks)
 *
 * LIVE_FORMAT picks the show: storytelling (one host), conversation or interview (two voices). The report includes
 * the automatic script and audio checks, so a sample can be judged by ear and by numbers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { createLlm, createLocalStorage, createStt, setFakeResponder, verifyBook } from '@thinkmade/ai';
import { createDb, defaultStageModel, getStageModel, runMigrations, schema, seedModelConfig, type ModelStage } from '@thinkmade/db';
import { DEFAULT_APP_SETTINGS } from '@thinkmade/shared';
import { createTts, runNextJob } from '../src/index';
import type { WorkerDeps } from '../src/deps';
import { fakeResponder } from '../src/testing/fake-responder';

const provider = process.env.LIVE_PROVIDER ?? 'ollama';
const model = process.env.LIVE_MODEL ?? 'qwen2.5:7b';
const minutes = Number(process.env.LIVE_MINUTES ?? 5);
const topic = process.env.LIVE_TOPIC ?? 'Why do projects in my small team always run late, and how should I think about fixing it?';
const format = (process.env.LIVE_FORMAT ?? 'conversation') as 'storytelling' | 'conversation' | 'interview';
const out = resolve(process.env.LIVE_OUT ?? '.data/live-check');
mkdirSync(out, { recursive: true });

const t0 = Date.now();
let audioChecks: unknown = null;
const h = await createDb({ pgliteDir: ':memory:' });
await runMigrations(h);
await h.db.insert(schema.appSetting).values({ name: 'app', version: 1, document: DEFAULT_APP_SETTINGS as never, active: true });
await h.db.insert(schema.user).values({ id: 'live', name: 'Live check', email: 'live@example.com', emailVerified: true });
// "stages" uses production's model for each stage, with its free fallbacks.
const stages = provider === 'stages';
// "fake" dry-runs the whole flow offline with the test model (pair it with TTS_PROVIDER=tone).
if (provider === 'fake') setFakeResponder(fakeResponder);
await seedModelConfig(h.db, stages ? null : { provider, model });
const storage = createLocalStorage(join(out, 'store'));
const [req] = await h.db.insert(schema.learningRequest).values({ userId: 'live', inputText: topic, learningMode: 'explore' }).returning();
const s = DEFAULT_APP_SETTINGS;
await h.db.insert(schema.generationJob).values({
  userId: 'live',
  learningRequestId: req!.id,
  options: {
    lengthMinutes: minutes, episodes: 1, speakerFormat: format === 'storytelling' ? 'single' : 'two_hosts', learningMode: 'explore', visibility: 'private', language: 'en',
    voicePool: s.voices.available, customized: true, production: { ...s.production, showFormat: format },
    teachingStyle: s.podcast.teachingStyle, voices: { single: s.voices.single, hostA: s.voices.hostA, hostB: s.voices.hostB },
    bitrateKbps: 64, maxTokens: s.limits.maxTokensPerJob, maxAudioMinutes: s.limits.maxAudioMinutesPerJob, quality: s.quality,
  } as never,
});
const deps: WorkerDeps = {
  db: h.db,
  llm: async (stage: ModelStage) => createLlm(stages ? ((await getStageModel(h.db, stage)) ?? defaultStageModel(stage, null)) : { provider, model }, process.env),
  tts: createTts({ ...process.env, NODE_ENV: 'development' }),
  stt: createStt(process.env),
  storage,
  verifyBook: (c) => verifyBook(c),
  workDir: join(out, 'work'),
  workerId: 'live-check',
  leaseSeconds: 3600,
  log: (m, x) => {
    console.info('[worker]', m, JSON.stringify(x ?? {}));
    if (m === 'episode ready') audioChecks = (x as { audioChecks?: unknown }).audioChecks;
  },
};
// A rate limit puts the job back in the queue for a while: wait and carry on (up to 20 minutes).
const giveUp = Date.now() + 20 * 60_000;
await runNextJob(deps);
for (let [j] = await h.db.select().from(schema.generationJob); j?.status === 'queued' && Date.now() < giveUp; [j] = await h.db.select().from(schema.generationJob)) {
  await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(60_000, j.runAfter.getTime() - Date.now()))));
  await runNextJob(deps);
}
const [j] = await h.db.select().from(schema.generationJob);
const eps = await h.db.select().from(schema.episode);
const report = {
  format, topic, provider, model, audioChecks, hosts: eps[0]?.hosts?.map((h) => ({ name: h.name, voice: h.voice, kind: h.kind, simulated: h.simulated, role: h.role })), minutesTaken: Number(((Date.now() - t0) / 60000).toFixed(1)), status: j!.status, error: j!.error, tokens: j!.tokensUsed,
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
