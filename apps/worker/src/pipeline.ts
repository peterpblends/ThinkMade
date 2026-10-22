import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  assembleEpisode,
  completeJson,
  countWords,
  LlmError,
  ProviderNotConfiguredError,
  type BookVerification,
  type ChatMessage,
} from '@thinkmade/ai';
import { queryRows, schema, type Db, type ModelStage } from '@thinkmade/db';
import { HOST_NAMES, type GenerationOptions, type GenerationStage } from '@thinkmade/shared';
import { JobCancelledError, PermanentJobError, type WorkerDeps } from './deps';
import { input, PLAN_TASK, RESEARCH_TASK, SCRIPT_TASK, SELECT_MODELS_TASK, stageSystem, UNDERSTAND_TASK } from './prompts';
import type { ClaimedJob } from './queue';
import { extendLease, requeueJob } from './queue';
import {
  modelSelectionSchema,
  planSchema,
  researchSchema,
  scriptSectionSchema,
  understandingSchema,
  type ModelSelection,
  type Plan,
  type PlannedEpisode,
  type Understanding,
} from './schemas';

export const WORDS_PER_MINUTE = 150;
const MINUTES_PER_SECTION = 4;

interface VerifiedBook {
  title: string;
  authors: string[];
  year?: number;
  isbn13?: string;
  openLibraryId?: string;
  googleBooksId?: string;
  via: string;
  why: string;
}

interface ResearchState {
  [slug: string]: { books: VerifiedBook[]; related: Array<{ name: string; relation: string }>; rejectedBooks: number };
}

interface ScriptState {
  [episodeNumber: string]: { sections: Array<{ segments: Array<{ speaker: 'A' | 'B'; text: string }>; summary: string }> };
}

export interface JobState {
  understanding?: Understanding;
  models?: ModelSelection['models'];
  research?: ResearchState;
  plan?: Plan;
  scripts?: ScriptState;
  tokens?: number;
}

/** Speaker format per episode: mixed alternates, starting with a two-host conversation. */
export function formatForEpisode(format: GenerationOptions['speakerFormat'], n: number): 'single' | 'two_hosts' {
  if (format === 'mixed') return n % 2 === 1 ? 'two_hosts' : 'single';
  return format;
}

export function sectionCount(lengthMinutes: number): number {
  return Math.max(1, Math.round(lengthMinutes / MINUTES_PER_SECTION));
}

class StageRunner {
  constructor(
    private db: Db,
    private jobId: string,
  ) {}

  async run<T>(stage: GenerationStage, fn: () => Promise<T>, episodeNumber?: number, note?: string): Promise<T> {
    await this.checkCancelled();
    await this.db.update(schema.generationJob).set({ currentStage: stage }).where(eq(schema.generationJob.id, this.jobId));
    const [row] = await this.db
      .insert(schema.generationStage)
      .values({ jobId: this.jobId, stage, status: 'running', startedAt: new Date(), ...(episodeNumber ? { episodeNumber } : {}), ...(note ? { note } : {}) })
      .returning({ id: schema.generationStage.id });
    try {
      const out = await fn();
      await this.db.update(schema.generationStage).set({ status: 'done', finishedAt: new Date() }).where(eq(schema.generationStage.id, row!.id));
      return out;
    } catch (err) {
      await this.db
        .update(schema.generationStage)
        .set({ status: 'failed', finishedAt: new Date(), note: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
        .where(eq(schema.generationStage.id, row!.id));
      throw err;
    }
  }

  async checkCancelled() {
    const [j] = await this.db
      .select({ c: schema.generationJob.cancelRequested })
      .from(schema.generationJob)
      .where(eq(schema.generationJob.id, this.jobId));
    if (j?.c) throw new JobCancelledError();
  }
}

async function saveState(db: Db, jobId: string, state: JobState) {
  await db.update(schema.generationJob).set({ state: state as Record<string, unknown>, tokensUsed: state.tokens ?? 0 }).where(eq(schema.generationJob.id, jobId));
}

async function coveredModelSlugs(db: Db, userId: string, excludeSeriesId: string | null): Promise<string[]> {
  const rows = await queryRows<{ slug: string }>(
    db,
    sql`select distinct m.slug from episode_mental_model em
        join episode e on e.id = em.episode_id
        join podcast_series s on s.id = e.series_id
        join mental_model m on m.id = em.mental_model_id
        where s.user_id = ${userId} and em.role = 'primary' and e.status = 'ready'
          and (${excludeSeriesId}::text is null or s.id <> ${excludeSeriesId}::text)`,
  );
  return rows.map((r) => r.slug);
}

async function upsertBook(db: Db, b: VerifiedBook): Promise<string> {
  const existing = b.openLibraryId
    ? await db.select({ id: schema.book.id }).from(schema.book).where(eq(schema.book.openLibraryId, b.openLibraryId))
    : b.googleBooksId
      ? await db.select({ id: schema.book.id }).from(schema.book).where(eq(schema.book.googleBooksId, b.googleBooksId))
      : [];
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(schema.book)
    .values({
      title: b.title,
      openLibraryId: b.openLibraryId ?? null,
      googleBooksId: b.googleBooksId ?? null,
      isbn13: b.isbn13 ?? null,
      firstPublishYear: b.year ?? null,
      verificationStatus: 'verified',
      verifiedVia: b.via,
      verifiedAt: new Date(),
    })
    .returning({ id: schema.book.id });
  for (const name of b.authors) {
    let [a] = await db.select({ id: schema.author.id }).from(schema.author).where(eq(schema.author.name, name));
    if (!a) [a] = await db.insert(schema.author).values({ name }).returning({ id: schema.author.id });
    await db.insert(schema.bookAuthor).values({ bookId: row!.id, authorId: a!.id }).onConflictDoNothing();
  }
  return row!.id;
}

async function sourceForBook(db: Db, bookId: string, b: VerifiedBook): Promise<string> {
  const [existing] = await db.select({ id: schema.source.id }).from(schema.source).where(eq(schema.source.bookId, bookId));
  if (existing) return existing.id;
  const url = b.openLibraryId
    ? `https://openlibrary.org${b.openLibraryId}`
    : b.googleBooksId
      ? `https://books.google.com/books?id=${b.googleBooksId}`
      : null;
  const [row] = await db
    .insert(schema.source)
    .values({ kind: 'book', title: `${b.title} — ${b.authors.join(', ')}`, url, bookId, year: b.year ?? null, verificationStatus: 'verified', verifiedVia: b.via, verifiedAt: new Date() })
    .returning({ id: schema.source.id });
  return row!.id;
}

/** Runs one claimed job to completion (or a clean, recorded failure). */
export async function runJob(job: ClaimedJob, deps: WorkerDeps): Promise<'succeeded' | 'partial' | 'failed' | 'cancelled' | 'requeued'> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const lease = deps.leaseSeconds ?? 600;
  const runner = new StageRunner(db, job.id);
  const options = job.options as unknown as GenerationOptions;
  const state = (job.state ?? {}) as JobState;
  state.tokens ??= 0;
  let seriesId = job.series_id;

  const chat = async <T>(stage: ModelStage, task: string, data: unknown, zschema: Parameters<typeof completeJson<T>>[2], maxTokens = 4096) => {
    const llm = await deps.llm(stage);
    const messages: ChatMessage[] = [
      { role: 'system', content: stageSystem(stage, task) },
      { role: 'user', content: input(data) },
    ];
    const res = await completeJson(llm, messages, zschema, { temperature: stage === 'script' ? 0.8 : 0.4, maxTokens });
    state.tokens! += res.usage.promptTokens + res.usage.completionTokens;
    if (options.maxTokens && state.tokens! > options.maxTokens) {
      throw new PermanentJobError(`This series hit its language-model budget (${options.maxTokens} tokens).`);
    }
    await extendLease(db, job.id, deps.workerId, lease);
    return res.data;
  };

  try {
    const [request] = await db.select().from(schema.learningRequest).where(eq(schema.learningRequest.id, job.learning_request_id));
    if (!request) throw new PermanentJobError('The learning request no longer exists.');

    // 1. Understand
    if (!state.understanding) {
      state.understanding = await runner.run('understand', () =>
        chat<Understanding>('understand', UNDERSTAND_TASK, {
          question: request.inputText ?? '',
          spokenTranscript: request.inputTranscript ?? '',
          mediaAnalysis: request.understanding ?? null,
          learningMode: options.learningMode,
        }, understandingSchema),
      );
      await db.update(schema.learningRequest).set({ objective: state.understanding.objective }).where(eq(schema.learningRequest.id, request.id));
      await saveState(db, job.id, state);
    }
    const u = state.understanding;

    if (!seriesId) {
      const [s] = await db
        .insert(schema.podcastSeries)
        .values({ userId: job.user_id, learningRequestId: request.id, title: u.seriesTitle, description: u.seriesDescription, visibility: options.visibility, status: 'generating' })
        .returning({ id: schema.podcastSeries.id });
      seriesId = s!.id;
      await db.update(schema.generationJob).set({ seriesId }).where(eq(schema.generationJob.id, job.id));
      await db.insert(schema.libraryItem).values({ userId: job.user_id, seriesId }).onConflictDoNothing();
    }

    // 2. Select mental models
    const covered = await coveredModelSlugs(db, job.user_id, seriesId);
    if (!state.models) {
      const want = options.episodes + 2;
      const sel = await runner.run('select_models', () =>
        chat<ModelSelection>('select_models', SELECT_MODELS_TASK, {
          objective: u.objective,
          context: u.context,
          keyQuestions: u.keyQuestions,
          learningMode: options.learningMode,
          coveredModels: covered,
          count: want,
        }, modelSelectionSchema),
      );
      let models = [...sel.models].sort((a, b) => b.score - a.score);
      if (options.learningMode === 'explore') models = models.filter((m) => !covered.includes(m.slug));
      const seen = new Set<string>();
      models = models.filter((m) => (seen.has(m.slug) ? false : (seen.add(m.slug), true)));
      if (models.length === 0) throw new PermanentJobError('No new mental models were found for this topic. Try Deepen or Reinforce instead.');
      state.models = models.slice(0, want);
      await saveState(db, job.id, state);
    }

    // 3. Research and verify books
    if (!state.research) {
      state.research = await runner.run('research', async () => {
        const r = await chat('research', RESEARCH_TASK, { models: state.models!.map((m) => ({ slug: m.slug, name: m.name, summary: m.summary })) }, researchSchema);
        const out: ResearchState = {};
        for (const m of state.models!) {
          const found = r.models.find((x) => x.slug === m.slug);
          const verified: VerifiedBook[] = [];
          let rejected = 0;
          for (const claim of (found?.books ?? []).slice(0, 4)) {
            const v: BookVerification = await deps.verifyBook({ title: claim.title, author: claim.author });
            if (v.verified) {
              if (!verified.some((b) => b.title === v.title)) {
                verified.push({
                  title: v.title, authors: v.authors, via: v.via, why: claim.why,
                  ...(v.year ? { year: v.year } : {}), ...(v.isbn13 ? { isbn13: v.isbn13 } : {}),
                  ...(v.openLibraryId ? { openLibraryId: v.openLibraryId } : {}), ...(v.googleBooksId ? { googleBooksId: v.googleBooksId } : {}),
                });
              }
            } else rejected++;
          }
          out[m.slug] = { books: verified, related: found?.related ?? [], rejectedBooks: rejected };
        }
        return out;
      });
      // Prefer models that have at least one verified book behind them.
      state.models = [...state.models!].sort((a, b) => Number((state.research![b.slug]?.books.length ?? 0) > 0) - Number((state.research![a.slug]?.books.length ?? 0) > 0));
      await saveState(db, job.id, state);
    }

    // Catalogue the chosen models.
    const chosen = state.models!.slice(0, Math.min(options.episodes, state.models!.length));
    const modelIds: Record<string, string> = {};
    for (const m of state.models!) {
      const [row] = await db
        .insert(schema.mentalModel)
        .values({ slug: m.slug, name: m.name, summary: m.summary, category: m.category })
        .onConflictDoUpdate({ target: schema.mentalModel.slug, set: { name: m.name } })
        .returning({ id: schema.mentalModel.id });
      modelIds[m.slug] = row!.id;
    }

    // 4. Plan
    if (!state.plan) {
      const sections = sectionCount(options.lengthMinutes);
      const episodesIn = Array.from({ length: options.episodes }, (_, i) => {
        const m = chosen[i % chosen.length]!;
        return { number: i + 1, primaryModelSlug: m.slug, speakerFormat: formatForEpisode(options.speakerFormat, i + 1), sections };
      });
      const plan = await runner.run('plan', () =>
        chat<Plan>('plan', PLAN_TASK, {
          objective: u.objective,
          context: u.context,
          evidence: u.evidence,
          assumptions: u.assumptions,
          learningMode: options.learningMode,
          teachingStyle: options.teachingStyle,
          lengthMinutes: options.lengthMinutes,
          episodes: episodesIn,
          models: state.models!.map((m) => ({ slug: m.slug, name: m.name, summary: m.summary, relevance: m.relevance, verifiedBooks: state.research![m.slug]?.books.map((b) => ({ title: b.title, author: b.authors.join(', ') })) ?? [], related: state.research![m.slug]?.related ?? [] })),
        }, planSchema, 8192),
      );
      // Enforce the requested shape regardless of what the model returned.
      const valid = new Set(state.models!.map((m) => m.slug));
      plan.episodes = episodesIn.map((want) => {
        const ep = plan.episodes.find((e) => e.number === want.number) ?? plan.episodes[want.number - 1];
        if (!ep) throw new Error(`The plan is missing episode ${want.number}`);
        return {
          ...ep,
          number: want.number,
          primaryModelSlug: valid.has(ep.primaryModelSlug) ? ep.primaryModelSlug : want.primaryModelSlug,
          supportingModelSlugs: ep.supportingModelSlugs.filter((s) => valid.has(s) && s !== ep.primaryModelSlug),
        };
      });
      state.plan = plan;
      await saveState(db, job.id, state);
    }

    // Episode rows (idempotent).
    const existing = await db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));
    for (const ep of state.plan.episodes) {
      if (existing.some((e) => e.number === ep.number)) continue;
      const format = formatForEpisode(options.speakerFormat, ep.number);
      const hosts =
        format === 'two_hosts'
          ? [{ id: 'A', name: HOST_NAMES.A, voice: options.voices.hostA }, { id: 'B', name: HOST_NAMES.B, voice: options.voices.hostB }]
          : [{ id: 'A', name: HOST_NAMES.A, voice: options.voices.single }];
      const [row] = await db
        .insert(schema.episode)
        .values({
          seriesId, number: ep.number, title: ep.title, description: ep.description, learningObjective: ep.learningObjective,
          primaryMentalModelId: modelIds[ep.primaryModelSlug] ?? null, speakerFormat: format, plannedMinutes: options.lengthMinutes,
          outcomes: ep.outcomes, keyTakeaways: ep.keyTakeaways, examples: ep.examples, hosts, status: 'pending',
        })
        .returning({ id: schema.episode.id });
      const episodeId = row!.id;
      const slugs = [ep.primaryModelSlug, ...ep.supportingModelSlugs];
      for (const slug of slugs) {
        if (!modelIds[slug]) continue;
        await db.insert(schema.episodeMentalModel).values({ episodeId, mentalModelId: modelIds[slug]!, role: slug === ep.primaryModelSlug ? 'primary' : 'supporting' }).onConflictDoNothing();
        for (const b of state.research![slug]?.books ?? []) {
          const bookId = await upsertBook(db, b);
          const sourceId = await sourceForBook(db, bookId, b);
          await db.insert(schema.episodeSource).values({ episodeId, sourceId, note: b.why || null }).onConflictDoNothing();
        }
      }
    }

    // 5–7. Script, check, synthesise each episode.
    state.scripts ??= {};
    const episodes = await db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));
    let audioSeconds = 0;
    for (const planned of state.plan.episodes) {
      const row = episodes.find((e) => e.number === planned.number)!;
      if (row.status === 'ready') continue;
      await writeAndVoiceEpisode(planned, row.id, row.speakerFormat as 'single' | 'two_hosts', row.hosts ?? []);
    }

    async function writeAndVoiceEpisode(ep: PlannedEpisode, episodeId: string, format: 'single' | 'two_hosts', hosts: Array<{ id: string; name: string; voice: string }>) {
      const totalWords = WORDS_PER_MINUTE * options.lengthMinutes;
      const perSection = Math.round(totalWords / ep.sections.length);
      const key = String(ep.number);
      state.scripts![key] ??= { sections: [] };
      const done = state.scripts![key]!.sections;
      await db.update(schema.episode).set({ status: 'scripting' }).where(eq(schema.episode.id, episodeId));
      for (let i = done.length; i < ep.sections.length; i++) {
        const section = await runner.run('script', () =>
          chat('script', SCRIPT_TASK, {
            seriesTitle: state.understanding!.seriesTitle,
            episode: { number: ep.number, title: ep.title, learningObjective: ep.learningObjective, outcomes: ep.outcomes, keyTakeaways: ep.keyTakeaways, examples: ep.examples },
            primaryModel: state.models!.find((m) => m.slug === ep.primaryModelSlug),
            supportingModels: ep.supportingModelSlugs.map((s) => state.models!.find((m) => m.slug === s)?.name).filter(Boolean),
            verifiedBooks: [ep.primaryModelSlug, ...ep.supportingModelSlugs].flatMap((s) => state.research![s]?.books ?? []).map((b) => ({ title: b.title, author: b.authors.join(', ') })),
            hosts: hosts.map((h) => ({ speaker: h.id, name: h.name })),
            format,
            section: { index: i + 1, of: ep.sections.length, heading: ep.sections[i]!.heading, goal: ep.sections[i]!.goal },
            isFirstSection: i === 0,
            isLastSection: i === ep.sections.length - 1,
            earlierSections: done.map((d) => d.summary),
            targetWords: perSection,
            listenerObjective: state.understanding!.objective,
          }, scriptSectionSchema, 6000),
          ep.number,
          `section ${i + 1} of ${ep.sections.length}`,
        );
        if (format === 'single') section.segments = section.segments.map((s) => ({ ...s, speaker: 'A' as const }));
        done.push({ segments: section.segments, summary: section.summary });
        await saveState(db, job.id, state);
      }

      const segments = done.flatMap((d) => d.segments);
      await runner.run('validate', async () => {
        const words = segments.reduce((n, s) => n + countWords(s.text), 0);
        if (words < totalWords * 0.4) {
          throw new Error(`The script for episode ${ep.number} is far too short (${words} of about ${totalWords} words).`);
        }
      }, ep.number);

      const nameOf = (id: string) => hosts.find((h) => h.id === id)?.name ?? 'Host';
      const voiceOf = (id: string) => hosts.find((h) => h.id === id)?.voice ?? options.voices.single;
      await db.update(schema.episode).set({ status: 'synthesizing', script: segments }).where(eq(schema.episode.id, episodeId));
      const workDir = join(deps.workDir, job.id);
      mkdirSync(workDir, { recursive: true });
      const outFile = join(workDir, `${episodeId}.mp3`);
      const audio = await runner.run('synthesize', () =>
        assembleEpisode({
          turns: segments.map((s) => ({ voice: voiceOf(s.speaker), text: s.text })),
          tts: deps.tts,
          outFile,
          workDir,
          bitrateKbps: options.bitrateKbps,
          onProgress: async () => {
            await extendLease(db, job.id, deps.workerId, lease);
          },
        }),
        ep.number,
      );
      const audioKey = `audio/${seriesId}/${episodeId}.mp3`;
      await deps.storage.putFile(audioKey, outFile, 'audio/mpeg');
      rmSync(outFile, { force: true });
      audioSeconds += audio.durationSeconds;
      const transcript = segments.map((s) => (format === 'two_hosts' ? `${nameOf(s.speaker)}: ${s.text}` : s.text)).join('\n\n');
      await db
        .update(schema.episode)
        .set({ status: 'ready', audioKey, audioBytes: audio.bytes, durationSeconds: audio.durationSeconds, transcript })
        .where(eq(schema.episode.id, episodeId));
      await db.insert(schema.usageMetric).values({ metric: 'tts_seconds', provider: deps.tts.name, value: audio.durationSeconds, userId: job.user_id, jobId: job.id });
      await db
        .update(schema.generationJob)
        .set({ audioSecondsGenerated: sql`${schema.generationJob.audioSecondsGenerated} + ${audio.durationSeconds}` })
        .where(eq(schema.generationJob.id, job.id));
      log('episode ready', { jobId: job.id, episode: ep.number, seconds: Math.round(audio.durationSeconds) });
      if (options.maxAudioMinutes && audioSeconds / 60 > options.maxAudioMinutes) {
        throw new PermanentJobError(`This series hit its audio budget (${options.maxAudioMinutes} minutes).`);
      }
    }

    // 8. Publish
    await runner.run('publish', async () => {
      await db.update(schema.podcastSeries).set({ status: 'ready' }).where(eq(schema.podcastSeries.id, seriesId!));
    });
    await db.insert(schema.usageMetric).values({ metric: 'llm_tokens', value: state.tokens ?? 0, userId: job.user_id, jobId: job.id });
    await db
      .update(schema.generationJob)
      .set({ status: 'succeeded', currentStage: 'publish', finishedAt: new Date(), lockedBy: null, lockedUntil: null, error: null, state: state as Record<string, unknown> })
      .where(eq(schema.generationJob.id, job.id));
    return 'succeeded';
  } catch (err) {
    await saveState(db, job.id, state).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof JobCancelledError) {
      await finalise('cancelled', 'Cancelled.');
      return 'cancelled';
    }
    const rateLimited = err instanceof LlmError && err.status === 429;
    const permanent = err instanceof PermanentJobError || err instanceof ProviderNotConfiguredError;
    if (!permanent && (rateLimited || job.attempts < job.max_attempts)) {
      const delay = rateLimited ? 60 : 15 * 2 ** (job.attempts - 1);
      await requeueJob(db, job.id, delay, message, !rateLimited);
      log('job requeued', { jobId: job.id, attempt: job.attempts, delay, message });
      return 'requeued';
    }
    const outcome = await finalise('failed', userFacingError(err));
    log('job failed', { jobId: job.id, message });
    return outcome;
  }

  async function finalise(status: 'failed' | 'cancelled', error: string): Promise<'failed' | 'partial' | 'cancelled'> {
    let final: 'failed' | 'partial' | 'cancelled' = status;
    if (seriesId) {
      const ready = await db
        .select({ id: schema.episode.id })
        .from(schema.episode)
        .where(and(eq(schema.episode.seriesId, seriesId), eq(schema.episode.status, 'ready')));
      if (status === 'failed' && ready.length > 0) final = 'partial';
      await db
        .update(schema.episode)
        .set({ status: 'failed' })
        .where(and(eq(schema.episode.seriesId, seriesId), inArray(schema.episode.status, ['pending', 'scripting', 'validating', 'synthesizing'])));
      await db.update(schema.podcastSeries).set({ status: final === 'cancelled' ? (ready.length ? 'partial' : 'failed') : final }).where(eq(schema.podcastSeries.id, seriesId));
    }
    await db
      .update(schema.generationJob)
      .set({ status: final, error, finishedAt: new Date(), lockedBy: null, lockedUntil: null })
      .where(eq(schema.generationJob.id, job.id));
    return final;
  }
}

function userFacingError(err: unknown): string {
  if (err instanceof ProviderNotConfiguredError) return `Podcast generation isn't configured yet: ${err.message}`;
  if (err instanceof PermanentJobError) return err.message;
  if (err instanceof LlmError) return 'The language model service failed repeatedly. Please try again later.';
  return `Something went wrong while building your podcasts: ${err instanceof Error ? err.message : String(err)}`;
}
