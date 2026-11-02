import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  assembleEpisode,
  completeJson,
  countWords,
  LlmError,
  ProviderNotConfiguredError,
  type BookVerification,
  type ChatMessage,
} from '@thinkmade/ai';
import { getActivePrompts, indexSeriesEmbedding, queryRows, schema, settleCancelledSeries, type Db, type ModelStage } from '@thinkmade/db';
import { castHosts, chooseHosts, chooseShowFormat, DEFAULT_APP_SETTINGS, DEFAULT_PRODUCTION, episodeShowFormat, HOST_IDS, voiceInfo, type GenerationOptions, type GenerationStage, type Host, type ListenerPreferences, type ShowFormat } from '@thinkmade/shared';
import { JobCancelledError, LostLeaseError, PermanentJobError, type WorkerDeps } from './deps';
import { overusedModels, rankForVariety } from './model-variety';
import { input, PLAN_TASK, RESEARCH_TASK, SCRIPT_TASK, SELECT_MODELS_TASK, stageSystem, UNDERSTAND_TASK } from './prompts';
import type { ClaimedJob } from './queue';
import { analyseUploads, type MediaAnalysis } from './media';
import { aggregateJudgements, CRITERIA_LABELS, failingCriteria, judgementSchema, judgeWindows, scriptChecks, VALIDATE_TASK, type EpisodeFormat, type Judgement } from './quality';
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
  [episodeNumber: string]: { sections: Array<{ segments: Array<{ speaker: 'A' | 'B' | 'C' | 'D'; text: string }>; summary: string }> };
}

export interface JobState {
  media?: { analyses: MediaAnalysis[]; notes: string[] };
  understanding?: Understanding;
  models?: ModelSelection['models'];
  research?: ResearchState;
  plan?: Plan;
  /** Episodes planned so far, while the plan is built in batches. */
  planDraft?: Plan['episodes'];
  /** Length, episodes or format the listener asked for in their own words. */
  adjusted?: Partial<Pick<GenerationOptions, 'episodes' | 'lengthMinutes' | 'speakerFormat'>>;
  /** This series' hosts and their voices. */
  hosts?: Host[];
  /** The series' show format: storytelling, conversation or interview. */
  showFormat?: ShowFormat;
  /** An interview series with one host throughout and a different guest each episode. */
  rotatingGuests?: boolean;
  /** Each episode's guest, cast once (by episode number). */
  episodeGuests?: Record<string, Host>;
  /** Episodes (by number) to plan again because a reviewer rejected them. */
  replan?: number[];
  /** The series' episode count once the episodes the listener added are planned. */
  extendTo?: number;
  scripts?: ScriptState;
  tokens?: number;
  rateLimitRetries?: number;
  /** When the job first found every AI provider at its limit (ms since epoch); cleared once one answers. */
  rateLimitedSince?: number;
}

/**
 * How long a job keeps waiting for a free AI allowance to come back before it gives up. Daily allowances
 * reset within 24 hours, so a podcast waits through a full day rather than failing.
 */
const RATE_LIMIT_PATIENCE_MS = 36 * 3600_000;
/** Episodes planned per request. */
const PLAN_BATCH = 3;

/** Speaker format per episode: mixed alternates, starting with a two-host conversation. */
export function formatForEpisode(format: GenerationOptions['speakerFormat'], n: number): 'single' | 'two_hosts' {
  if (format === 'mixed') return n % 2 === 1 ? 'two_hosts' : 'single';
  return format;
}

/** The hosts of one episode: the first host alone, or all of them in a conversation. */
export function episodeHosts(all: Host[], format: 'single' | 'two_hosts'): Host[] {
  return format === 'single' ? all.slice(0, 1) : all;
}

export function episodeFormat(hosts: unknown[]): EpisodeFormat {
  return hosts.length <= 1 ? 'single' : hosts.length === 2 ? 'two_hosts' : 'group';
}

/**
 * Length, episode count and format the listener asked for in their own words. These apply only when they
 * didn't set them in Customise, and never beyond the administrator's limits.
 */
export function listenerAdjustments(options: GenerationOptions, prefs: ListenerPreferences): NonNullable<JobState['adjusted']> {
  if (options.customized) return {};
  const p = DEFAULT_APP_SETTINGS.podcast;
  const lim = options.limits ?? { maxEpisodes: p.maxEpisodesPerSeries, maxMinutes: p.maxEpisodeMinutes };
  const out: NonNullable<JobState['adjusted']> = {};
  if (prefs.lengthMinutes) out.lengthMinutes = Math.min(prefs.lengthMinutes, lim.maxMinutes);
  const minutes = out.lengthMinutes ?? options.lengthMinutes;
  if (prefs.episodes) {
    const byAudio = options.maxAudioMinutes ? Math.max(1, Math.floor(options.maxAudioMinutes / minutes)) : Infinity;
    out.episodes = Math.max(1, Math.min(prefs.episodes, lim.maxEpisodes, byAudio));
  }
  // Hosts the listener described all take part in every episode.
  if (prefs.speakerFormat === 'single') out.speakerFormat = 'single';
  else if (prefs.speakerFormat === 'conversation' || prefs.hosts.length > 1) out.speakerFormat = 'two_hosts';
  return out;
}

async function recentVoices(db: Db, userId: string, excludeSeriesId: string | null): Promise<string[]> {
  const rows = await queryRows<{ hosts: Array<{ voice?: string }> | null }>(
    db,
    sql`select e.hosts from episode e join podcast_series s on s.id = e.series_id
        where s.user_id = ${userId} and (${excludeSeriesId}::text is null or s.id <> ${excludeSeriesId}::text)
        order by s.created_at desc limit 12`,
  );
  return [...new Set(rows.flatMap((r) => (r.hosts ?? []).map((h) => h.voice).filter((v): v is string => !!v)))];
}

export function sectionCount(lengthMinutes: number): number {
  return Math.max(1, Math.round(lengthMinutes / MINUTES_PER_SECTION));
}

class StageRunner {
  constructor(
    private db: Db,
    private jobId: string,
    private workerId: string,
  ) {}

  /** Throws if another worker has taken this job over (our lease expired). */
  async checkOwnership() {
    const [j] = await this.db.select({ by: schema.generationJob.lockedBy }).from(schema.generationJob).where(eq(schema.generationJob.id, this.jobId));
    if (j?.by !== this.workerId) throw new LostLeaseError();
  }

  async run<T>(stage: GenerationStage, fn: () => Promise<T>, episodeNumber?: number, note?: string): Promise<T> {
    await this.checkOwnership();
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
export async function runJob(job: ClaimedJob, deps: WorkerDeps): Promise<'succeeded' | 'partial' | 'failed' | 'cancelled' | 'requeued' | 'lost_lease'> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const lease = deps.leaseSeconds ?? 600;
  const runner = new StageRunner(db, job.id, deps.workerId);
  const options = job.options as unknown as GenerationOptions;
  const state = (job.state ?? {}) as JobState;
  state.tokens ??= 0;
  let seriesId = job.series_id;

  const overrides = await getActivePrompts(db);
  // Cancelling marks the job cancelled (and clears our lease) at once. Notice within seconds and interrupt
  // whatever is in progress: a model request, a rate-limit wait or voicing.
  const stop = new AbortController();
  const watch = setInterval(() => {
    void db
      .select({ status: schema.generationJob.status, lockedBy: schema.generationJob.lockedBy })
      .from(schema.generationJob)
      .where(eq(schema.generationJob.id, job.id))
      .then(([j]) => {
        if (!j || j.status === 'cancelled' || j.lockedBy !== deps.workerId) stop.abort();
      })
      .catch(() => {});
  }, deps.cancelPollMs ?? 2000);
  watch.unref?.();
  const chat = async <T>(stage: ModelStage, task: string, data: unknown, zschema: Parameters<typeof completeJson<T>>[2], maxTokens = 4096) => {
    const llm = await deps.llm(stage);
    const messages: ChatMessage[] = [
      { role: 'system', content: stageSystem(stage, overrides.get(stage) ?? task) },
      { role: 'user', content: input(data) },
    ];
    // Model selection runs warmer, so series don't keep landing on the same few models.
    const temperature = stage === 'script' ? 0.8 : stage === 'select_models' ? 0.7 : 0.4;
    const res = await completeJson(llm, messages, zschema, { temperature, maxTokens, signal: stop.signal });
    state.tokens! += res.usage.promptTokens + res.usage.completionTokens;
    // An answer means the allowance is back: a later limit starts a fresh wait.
    delete state.rateLimitedSince;
    if (options.maxTokens && state.tokens! > options.maxTokens) {
      throw new PermanentJobError(`This series hit its language-model budget (${options.maxTokens} tokens).`);
    }
    await extendLease(db, job.id, deps.workerId, lease);
    return res.data;
  };

  try {
    const [request] = await db.select().from(schema.learningRequest).where(eq(schema.learningRequest.id, job.learning_request_id));
    if (!request) throw new PermanentJobError('The learning request no longer exists.');

    // 0. Photos and videos
    if (!state.media && request.mediaUploadIds.length) {
      state.media = await runner.run('analyze_media', () =>
        analyseUploads(deps, request.mediaUploadIds, request.inputText ?? '', (n) => {
          state.tokens! += n;
          void extendLease(db, job.id, deps.workerId, lease);
        }),
      );
      await saveState(db, job.id, state);
    }
    // A podcast created from a coaching conversation builds on that conversation and its episode.
    let coaching: { episodeTitle: string; episodeModel: string | null; conversation: Array<{ role: string; content: string }> } | null = null;
    let coachingModelSlug: string | null = null;
    if (request.coachingSessionId) {
      const [cs] = await db.select().from(schema.coachingSession).where(eq(schema.coachingSession.id, request.coachingSessionId));
      if (cs) {
        const [e] = await db.select().from(schema.episode).where(eq(schema.episode.id, cs.episodeId));
        const [m] = e?.primaryMentalModelId ? await db.select().from(schema.mentalModel).where(eq(schema.mentalModel.id, e.primaryMentalModelId)) : [];
        coachingModelSlug = m?.slug ?? null;
        const msgs = await db.select().from(schema.coachingMessage).where(eq(schema.coachingMessage.sessionId, cs.id)).orderBy(schema.coachingMessage.createdAt);
        coaching = { episodeTitle: e?.title ?? '', episodeModel: m?.name ?? null, conversation: msgs.slice(-12).map((x) => ({ role: x.role, content: x.content.slice(0, 1500) })) };
      }
    }
    // Continued learning: build on a parent series (explore new models, go deeper, reinforce, or update).
    let parent: { title: string; objective: string | null; modelSlugs: string[]; modelNames: string[]; books: string[]; year: number } | null = null;
    if (request.parentSeriesId) {
      const [ps] = await db.select().from(schema.podcastSeries).where(eq(schema.podcastSeries.id, request.parentSeriesId));
      if (ps) {
        const rows = await queryRows<{ slug: string; name: string }>(
          db,
          sql`select distinct m.slug, m.name from episode e join episode_mental_model em on em.episode_id = e.id join mental_model m on m.id = em.mental_model_id where e.series_id = ${ps.id}`,
        );
        const books = await queryRows<{ title: string }>(
          db,
          sql`select distinct so.title from episode e join episode_source es on es.episode_id = e.id join source so on so.id = es.source_id where e.series_id = ${ps.id}`,
        );
        const [pr] = await db.select().from(schema.learningRequest).where(eq(schema.learningRequest.id, ps.learningRequestId));
        parent = {
          title: ps.title,
          objective: ps.userId === job.user_id ? (pr?.objective ?? null) : ps.description,
          modelSlugs: rows.map((r) => r.slug),
          modelNames: rows.map((r) => r.name),
          books: books.map((b) => b.title),
          year: ps.createdAt.getFullYear(),
        };
      }
    }
    const mediaAnalysis = state.media?.analyses.length
      ? state.media.analyses.map((a) => ({ kind: a.kind, summary: a.summary, visibleEvidence: a.visibleEvidence, assumptions: a.assumptions, visibleText: a.visibleText, ...(a.transcript ? { spokenInVideo: a.transcript } : {}) }))
      : null;

    // 1. Understand
    if (!state.understanding) {
      state.understanding = await runner.run('understand', () =>
        chat<Understanding>('understand', UNDERSTAND_TASK, {
          question:
            request.inputText ||
            (mediaAnalysis
              ? 'Help me think about what I am showing you.'
              : coaching
                ? `Build on my coaching conversation about "${coaching.episodeTitle}".`
                : parent
                  ? `${request.updateMode ? 'Update' : 'Continue'} my learning from "${parent.title}".`
                  : ''),
          continuingFrom: parent && { seriesTitle: parent.title, objective: parent.objective, mentalModels: parent.modelNames, updateMode: request.updateMode },
          coachingConversation: coaching,
          spokenTranscript: request.inputTranscript ?? '',
          mediaAnalysis,
          learningMode: options.learningMode,
        }, understandingSchema),
      );
      await db
        .update(schema.learningRequest)
        .set({ objective: state.understanding.objective, understanding: { ...state.understanding, media: mediaAnalysis } as unknown as Record<string, unknown> })
        .where(eq(schema.learningRequest.id, request.id));
      await saveState(db, job.id, state);
    }
    const u = state.understanding;
    const prefs: ListenerPreferences = u.preferences ?? { hosts: [], requests: [] };

    // What the listener asked for in their own words: length, episodes, format and hosts.
    if (!state.plan && !state.adjusted) state.adjusted = listenerAdjustments(options, prefs);
    Object.assign(options, state.adjusted ?? {});
    const production = { ...DEFAULT_PRODUCTION, ...options.production };
    state.showFormat ??= chooseShowFormat({ speakerFormat: options.speakerFormat, production, requested: prefs.showFormat, suggested: u.suggestedFormat });
    const pool = options.voicePool ?? DEFAULT_APP_SETTINGS.voices.available;
    // A British audience (or a request for British voices) gets British voices unless a host says otherwise.
    const preferAccent = /\b(british|uk|united kingdom|england|english accents?)\b/i.test([u.audience, ...prefs.requests].join(' ')) ? ('UK' as const) : null;
    if (!state.hosts) {
      const described = prefs.hosts.filter((h) => h.name || h.role || h.gender || h.heritage);
      // Interviews keep one host throughout and bring a new guest each episode, unless the listener described
      // their own cast or picked voices for it.
      state.rotatingGuests = state.showFormat === 'interview' && production.rotateGuests && described.length === 0 && !options.chosenVoices?.length;
      const count = options.speakerFormat === 'single' || state.rotatingGuests ? 1 : Math.max(2, described.length, options.chosenVoices?.length ?? 0);
      state.hosts = chooseHosts({
        count,
        requested: described,
        ...(options.chosenVoices ? { chosenVoices: options.chosenVoices } : {}),
        ...(options.voiceGender ? { gender: options.voiceGender } : {}),
        pool,
        ...(options.voiceProfiles ? { profiles: options.voiceProfiles } : {}),
        preferAccent,
        recent: await recentVoices(db, job.user_id, seriesId),
      });
      // Every host gets a distinct part: the listener's description, or a complementary default.
      state.hosts = castHosts(state.hosts, state.showFormat, production.hostStyle);
      await saveState(db, job.id, state);
    }
    const hostsForPrompt = (hosts: Array<{ id: string; name: string; age?: number; role?: string; kind?: 'host' | 'guest'; simulated?: boolean }>) =>
      hosts.map((h) => ({
        speaker: h.id,
        name: h.name,
        ...(h.age ? { age: h.age } : {}),
        ...(h.role ? { role: h.role } : {}),
        ...(h.kind ? { kind: h.kind } : {}),
        ...(h.simulated ? { simulated: true } : {}),
      }));
    const listener = { audience: u.audience, listenerRequests: prefs.requests };
    /**
     * The people in one episode: the series' hosts (just the first in a single-host episode) and, in an
     * interview series with rotating guests, that episode's own guest, cast once to suit the episode and never
     * reusing a voice or name from elsewhere in the series.
     */
    const castEpisode = (ep: PlannedEpisode, recast = false): Host[] => {
      const format = formatForEpisode(options.speakerFormat, ep.number);
      const base = episodeHosts(state.hosts!, format);
      if (!state.rotatingGuests || format === 'single') return base;
      state.episodeGuests ??= {};
      const key = String(ep.number);
      if (recast) delete state.episodeGuests[key];
      if (!state.episodeGuests[key]) {
        const others = [...base, ...Object.values(state.episodeGuests)];
        const [guest] = chooseHosts({
          count: 1,
          // The listener's female or male preference covers guests too.
          requested: [{ gender: options.voiceGender ?? ep.guest?.gender ?? null, age: ep.guest?.age ?? null }],
          pool,
          ...(options.voiceProfiles ? { profiles: options.voiceProfiles } : {}),
          preferAccent: preferAccent ?? voiceInfo(base[0]!.voice)?.accent ?? null,
          exclude: others.map((h) => h.voice),
          takenNames: others.map((h) => h.name),
          ids: [HOST_IDS[base.length]!],
        });
        const about = ep.guest ? `${ep.guest.expertise}${ep.guest.perspective ? `. ${ep.guest.perspective}` : ''}` : 'An expert on this episode\'s subject.';
        state.episodeGuests[key] = {
          ...guest!,
          role: `A simulated expert guest: ${about} Speaks from the research and well-documented cases, never claims personal experiences or to be a real person.`,
          kind: 'guest',
          simulated: true,
        };
      }
      return [...base, state.episodeGuests[key]!];
    };

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
    if (coachingModelSlug && !covered.includes(coachingModelSlug)) covered.push(coachingModelSlug);
    if (!state.models) {
      // Ask for more candidates than episodes, so models without a verified book can be dropped and the
      // AI's usual favourites set aside, and still leave enough topic-specific models to fill the series.
      const candidates = Math.min(24, options.episodes + 6);
      // In deepen and reinforce the person's own models are the point, so they are never treated as overused.
      const focus = new Set(options.learningMode === 'explore' ? [] : [...covered, ...(parent?.modelSlugs ?? [])]);
      const overused = (await overusedModels(db)).filter((m) => !focus.has(m.slug));
      const sel = await runner.run('select_models', () =>
        chat<ModelSelection>('select_models', SELECT_MODELS_TASK, {
          question: request.inputText ?? request.inputTranscript ?? undefined,
          objective: u.objective,
          context: u.context,
          audience: u.audience,
          keyQuestions: u.keyQuestions,
          learningMode: options.learningMode,
          coveredModels: covered,
          ...(overused.length ? { overusedModels: overused.map((m) => m.name) } : {}),
          ...(parent && options.learningMode !== 'explore' ? { focusModels: parent.modelSlugs } : {}),
          count: candidates,
        }, modelSelectionSchema, 6144),
      );
      let models = sel.models;
      if (options.learningMode === 'explore') models = models.filter((m) => !covered.includes(m.slug));
      models = rankForVariety(models, { overused: overused.map((m) => m.slug), keep: focus });
      if (models.length === 0) throw new PermanentJobError('No new mental models were found for this topic. Try Deepen or Reinforce instead.');
      // Research (and book checks) for a few more than needed, not every candidate.
      state.models = models.slice(0, options.episodes + 4);
      await saveState(db, job.id, state);
    }

    // 3. Research and verify books
    if (!state.research) {
      state.research = await runner.run('research', async () => {
        const r = await chat('research', RESEARCH_TASK, {
          objective: u.objective,
          models: state.models!.map((m) => ({ slug: m.slug, name: m.name, summary: m.summary, ...(m.sourceBook ? { sourceBook: m.sourceBook } : {}) })),
          note: 'Return the models in the same order, keeping each slug exactly as given.',
          ...(parent && options.learningMode === 'reinforce' ? { avoidBooks: parent.books, instruction: 'Prefer different books from those in avoidBooks.' } : {}),
          ...(parent && request.updateMode ? { publishedAfterYear: parent.year - 1, instruction: 'Prefer books published after publishedAfterYear.' } : {}),
        }, researchSchema);
        const out: ResearchState = {};
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
        for (const [idx, m] of state.models!.entries()) {
          // Models sometimes rename slugs in their reply: match by slug, then by name, then by position.
          const found =
            r.models.find((x) => x.slug === m.slug) ??
            r.models.find((x) => norm(x.slug) === norm(m.name) || norm(x.slug).includes(norm(m.slug)) || norm(m.slug).includes(norm(x.slug))) ??
            (r.models.length === state.models!.length ? r.models[idx] : undefined);
          if (!found) log('research reply missing model', { jobId: job.id, slug: m.slug });
          const verified: VerifiedBook[] = [];
          let rejected = 0;
          for (const claim of (found?.books ?? []).slice(0, 4)) {
            const v: BookVerification = await deps.verifyBook({ title: claim.title, author: claim.author });
            await extendLease(db, job.id, deps.workerId, lease);
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
      // Every episode is taught from real books: models without a verified book are dropped, as long as
      // enough remain for the series (otherwise they go last, behind the ones with books).
      const booked = (m: { slug: string }) => (state.research![m.slug]?.books.length ?? 0) > 0;
      const withBooks = state.models!.filter(booked);
      state.models = (withBooks.length >= options.episodes ? withBooks : [...withBooks, ...state.models!.filter((m) => !booked(m))]).slice(0, options.episodes + 2);
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

    const valid = new Set(state.models!.map((m) => m.slug));
    /** Plans the given episodes in one request, keeping each to its requested number and to known models. */
    const planEpisodes = async (
      batch: Array<{ number: number; primaryModelSlug: string; speakerFormat: string; sections: number }>,
      earlier: PlannedEpisode[],
      instruction: string | null,
      note: string,
    ): Promise<PlannedEpisode[]> => {
      const part = await runner.run('plan', () =>
        chat<Plan>('plan', PLAN_TASK, {
          objective: u.objective,
          context: u.context,
          evidence: u.evidence,
          assumptions: u.assumptions,
          learningMode: options.learningMode,
          teachingStyle: options.teachingStyle,
          lengthMinutes: options.lengthMinutes,
          ...listener,
          showFormat: state.showFormat,
          hosts: hostsForPrompt(state.hosts!),
          ...(state.rotatingGuests ? { rotatingGuests: true } : {}),
          totalEpisodes: options.episodes,
          ...(earlier.length ? { earlierEpisodes: earlier.map((e) => ({ number: e.number, title: e.title, primaryModelSlug: e.primaryModelSlug, learningObjective: e.learningObjective })) } : {}),
          ...(instruction ? { instruction } : {}),
          episodes: batch,
          models: state.models!.map((m) => ({ slug: m.slug, name: m.name, summary: m.summary, relevance: m.relevance, verifiedBooks: state.research![m.slug]?.books.map((b) => ({ title: b.title, author: b.authors.join(', ') })) ?? [], related: state.research![m.slug]?.related ?? [] })),
        }, planSchema.refine((p) => p.episodes.length >= batch.length, {
          // Sent back to the model, which then corrects its plan instead of the job failing.
          message: `Plan all ${batch.length} episodes, numbered ${batch[0]!.number} to ${batch.at(-1)!.number}; the reply had fewer.`,
          path: ['episodes'],
        }), 8192),
      undefined, note);
      // Enforce the requested shape regardless of what the model returned.
      return batch.map((want, i) => {
        const ep = part.episodes.find((e) => e.number === want.number) ?? part.episodes[i];
        if (!ep) throw new Error(`The plan is missing episode ${want.number}`);
        const primaryModelSlug = valid.has(ep.primaryModelSlug) ? ep.primaryModelSlug : want.primaryModelSlug;
        return { ...ep, number: want.number, primaryModelSlug, supportingModelSlugs: ep.supportingModelSlugs.filter((x) => valid.has(x) && x !== primaryModelSlug) };
      });
    };
    /** Links an episode to its mental models and their verified books. */
    const linkEpisode = async (episodeId: string, ep: PlannedEpisode) => {
      for (const slug of [ep.primaryModelSlug, ...ep.supportingModelSlugs]) {
        if (!modelIds[slug]) continue;
        await db.insert(schema.episodeMentalModel).values({ episodeId, mentalModelId: modelIds[slug]!, role: slug === ep.primaryModelSlug ? 'primary' : 'supporting' }).onConflictDoNothing();
        for (const b of state.research![slug]?.books ?? []) {
          const bookId = await upsertBook(db, b);
          const sourceId = await sourceForBook(db, bookId, b);
          await db.insert(schema.episodeSource).values({ episodeId, sourceId, note: b.why || null }).onConflictDoNothing();
        }
      }
    };

    // 4. Plan
    if (!state.plan) {
      const sections = sectionCount(options.lengthMinutes);
      const episodesIn = Array.from({ length: options.episodes }, (_, i) => {
        const m = chosen[i % chosen.length]!;
        return { number: i + 1, primaryModelSlug: m.slug, speakerFormat: formatForEpisode(options.speakerFormat, i + 1), sections };
      });
      // Plan a few episodes per request: free models stop early on long replies, and a series can have 50.
      // Each batch sees the episodes already planned, and progress is saved so a retry carries on from it.
      state.planDraft ??= [];
      while (state.planDraft.length < episodesIn.length) {
        const batch = episodesIn.slice(state.planDraft.length, state.planDraft.length + PLAN_BATCH);
        const earlier = state.planDraft;
        state.planDraft.push(
          ...(await planEpisodes(batch, earlier, earlier.length ? `Plan only episodes ${batch[0]!.number} to ${batch.at(-1)!.number}. earlierEpisodes are already planned: build on them and don't repeat them.` : null, `Episodes ${batch[0]!.number}–${batch.at(-1)!.number} of ${episodesIn.length}`)),
        );
        await saveState(db, job.id, state);
      }
      const plan: Plan = { episodes: state.planDraft };
      delete state.planDraft;
      state.plan = plan;
      await saveState(db, job.id, state);
    }

    // More episodes for an existing series: continue after the last one, starting with models it hasn't taught yet.
    if (state.extendTo && state.extendTo > state.plan.episodes.length) {
      const taught = new Set(state.plan.episodes.map((e) => e.primaryModelSlug));
      const order = [...state.models!.filter((m) => !taught.has(m.slug)), ...state.models!];
      const from = state.plan.episodes.length;
      while (state.plan.episodes.length < state.extendTo) {
        const next = Math.max(...state.plan.episodes.map((e) => e.number)) + 1;
        const batch = Array.from({ length: Math.min(PLAN_BATCH, state.extendTo - state.plan.episodes.length) }, (_, i) => ({
          number: next + i,
          primaryModelSlug: order[(state.plan!.episodes.length - from + i) % order.length]!.slug,
          speakerFormat: formatForEpisode(options.speakerFormat, next + i),
          sections: sectionCount(options.lengthMinutes),
        }));
        state.plan.episodes.push(
          ...(await planEpisodes(
            batch,
            state.plan.episodes,
            `Continue the series with episodes ${batch[0]!.number} to ${batch.at(-1)!.number}. earlierEpisodes are already published: build on them, take the listener further, and don't repeat them.`,
            `More episodes: ${batch[0]!.number}–${batch.at(-1)!.number}`,
          )),
        );
        await saveState(db, job.id, state);
      }
    }
    delete state.extendTo;

    // Episode rows (idempotent). Never add rows to a series whose job was just cancelled.
    await runner.checkOwnership();
    const existing = await db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));
    for (const ep of state.plan.episodes) {
      if (existing.some((e) => e.number === ep.number)) continue;
      const hosts = castEpisode(ep);
      const format = episodeFormat(hosts);
      const [row] = await db
        .insert(schema.episode)
        .values({
          seriesId, number: ep.number, title: ep.title, description: ep.description, learningObjective: ep.learningObjective,
          primaryMentalModelId: modelIds[ep.primaryModelSlug] ?? null, speakerFormat: format, plannedMinutes: options.lengthMinutes,
          outcomes: ep.outcomes, keyTakeaways: ep.keyTakeaways, examples: ep.examples, hosts, status: 'pending',
        })
        .returning({ id: schema.episode.id });
      await linkEpisode(row!.id, ep);
    }
    if (state.rotatingGuests) await saveState(db, job.id, state);

    // Replacements for episodes a reviewer rejected: plan a different episode in the same place and start it
    // afresh. The row (and its review history) is kept; its content, script and audio are replaced.
    for (const number of [...(state.replan ?? [])]) {
      const idx = state.plan.episodes.findIndex((e) => e.number === number);
      const row = existing.find((e) => e.number === number);
      if (idx >= 0 && row) {
        const [rejection] = await db
          .select({ notes: schema.episodeQualityCheck.notes })
          .from(schema.episodeQualityCheck)
          .where(and(eq(schema.episodeQualityCheck.episodeId, row.id), eq(schema.episodeQualityCheck.checkedBy, 'human'), eq(schema.episodeQualityCheck.passed, 0)))
          .orderBy(desc(schema.episodeQualityCheck.revision))
          .limit(1);
        const old = state.plan.episodes[idx]!;
        const reason = rejection?.notes?.[0];
        const [ep] = await planEpisodes(
          [{ number, primaryModelSlug: old.primaryModelSlug, speakerFormat: formatForEpisode(options.speakerFormat, number), sections: sectionCount(options.lengthMinutes) }],
          state.plan.episodes.filter((e) => e.number !== number),
          `Plan a replacement for episode ${number} only. A reviewer rejected the previous version, "${old.title}"${reason ? `, noting: ${reason}` : ''}. Make it clearly different from that version while still fitting between the other episodes (earlierEpisodes).`,
          `Replacement for episode ${number}`,
        );
        state.plan.episodes[idx] = ep!;
        delete state.scripts?.[String(number)];
        await db
          .update(schema.episode)
          .set({
            title: ep!.title, description: ep!.description, learningObjective: ep!.learningObjective, outcomes: ep!.outcomes, keyTakeaways: ep!.keyTakeaways, examples: ep!.examples,
            primaryMentalModelId: modelIds[ep!.primaryModelSlug] ?? null, status: 'pending', script: null, transcript: null, audioKey: null, audioBytes: null, durationSeconds: null,
            // A replacement interview brings its own guest.
            ...(state.rotatingGuests ? { hosts: castEpisode(ep!, true) } : {}),
          })
          .where(eq(schema.episode.id, row.id));
        await db.delete(schema.episodeMentalModel).where(eq(schema.episodeMentalModel.episodeId, row.id));
        await db.delete(schema.episodeSource).where(eq(schema.episodeSource.episodeId, row.id));
        await linkEpisode(row.id, ep!);
      }
      state.replan = (state.replan ?? []).filter((n) => n !== number);
      await saveState(db, job.id, state);
    }

    // 5–7. Script, check, synthesise each episode.
    state.scripts ??= {};
    const episodes = await db.select().from(schema.episode).where(eq(schema.episode.seriesId, seriesId));
    let audioSeconds = 0;
    let held = 0;
    // Episodes a reviewer rejected are off the series: they are neither written again nor reported as failures.
    // (Before the "rejected" status, a rejection left the episode "failed" with a human check.)
    const humanRejected = new Set(
      (
        await db
          .select({ id: schema.episodeQualityCheck.episodeId })
          .from(schema.episodeQualityCheck)
          .where(and(eq(schema.episodeQualityCheck.checkedBy, 'human'), eq(schema.episodeQualityCheck.passed, 0)))
      ).map((r) => r.id),
    );
    const isRejected = (row: { id: string; status: string }) => row.status === 'rejected' || (row.status === 'failed' && humanRejected.has(row.id));
    for (const planned of state.plan.episodes) {
      const row = episodes.find((e) => e.number === planned.number)!;
      if (row.status === 'ready' || isRejected(row)) continue;
      if (row.status === 'needs_review') {
        held++;
        continue;
      }
      const result = await writeAndVoiceEpisode(planned, row.id, row.speakerFormat as EpisodeFormat, row.hosts ?? []);
      if (result === 'needs_review') held++;
    }
    const kept = state.plan.episodes.filter((p) => !isRejected(episodes.find((e) => e.number === p.number)!)).length;
    if (held > 0 || kept === 0) {
      let notified = false;
      if (held > 0 && deps.notifyAdmins) {
        notified = await deps
          .notifyAdmins(
            `ThinkMade: ${held} episode${held > 1 ? 's' : ''} held for quality review`,
            `"${state.understanding?.seriesTitle ?? 'A series'}" has ${held} episode${held > 1 ? 's' : ''} that did not pass automatic review. Review them in Admin → Quality.`,
          )
          .catch(() => false);
      }
      const all = held === kept;
      const message = all
        ? `Your podcasts did not pass our quality review, so we did not record them.${notified ? ' Our team has been notified.' : ''} Please try rephrasing your question.`
        : `${held} episode${held > 1 ? 's' : ''} did not pass our quality review and ${held > 1 ? 'were' : 'was'} not recorded.${notified ? ' Our team has been notified.' : ''} The rest are ready.`;
      await db.insert(schema.usageMetric).values({ metric: 'llm_tokens', value: state.tokens ?? 0, userId: job.user_id, jobId: job.id });
      return await finalise('failed', message);
    }

    async function writeAndVoiceEpisode(ep: PlannedEpisode, episodeId: string, format: EpisodeFormat, hosts: Array<{ id: string; name: string; voice: string; age?: number; role?: string }>): Promise<'ready' | 'needs_review'> {
      const hostIds = hosts.map((h) => h.id);
      // Lines given to a speaker this episode doesn't have go to the first host.
      const ownSpeakers = <T extends { speaker: string }>(segs: T[]) => segs.map((x) => (hostIds.includes(x.speaker) ? x : { ...x, speaker: 'A' as const }));
      const totalWords = WORDS_PER_MINUTE * options.lengthMinutes;
      const perSection = Math.round(totalWords / ep.sections.length);
      const key = String(ep.number);
      state.scripts![key] ??= { sections: [] };
      const done = state.scripts![key]!.sections;
      const quality = options.quality ?? { minScore: 4, maxRevisions: 2 };
      await db.update(schema.episode).set({ status: 'scripting' }).where(eq(schema.episode.id, episodeId));

      const showFormat = episodeShowFormat(state.showFormat ?? 'conversation', hosts.length);
      const nameFor = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
      const writeSection = async (i: number, revision?: { notes: string; problems: string[]; previous: string }) => {
        // The exact end of the section before, so the conversation carries on rather than restarting.
        const previousLines = i > 0 ? (done[i - 1]?.segments ?? []).slice(-4).map((x) => `${nameFor(x.speaker)}: ${x.text}`) : [];
        const section = await runner.run('script', () =>
          chat('script', SCRIPT_TASK, {
            seriesTitle: state.understanding!.seriesTitle,
            showFormat,
            episode: { number: ep.number, title: ep.title, learningObjective: ep.learningObjective, outcomes: ep.outcomes, keyTakeaways: ep.keyTakeaways, examples: ep.examples, hook: ep.hook, throughline: ep.throughline },
            primaryModel: state.models!.find((m) => m.slug === ep.primaryModelSlug),
            supportingModels: ep.supportingModelSlugs.map((s) => state.models!.find((m) => m.slug === s)?.name).filter(Boolean),
            verifiedBooks: [ep.primaryModelSlug, ...ep.supportingModelSlugs].flatMap((s) => state.research![s]?.books ?? []).map((b) => ({ title: b.title, author: b.authors.join(', ') })),
            hosts: hostsForPrompt(hosts),
            format,
            ...listener,
            section: { index: i + 1, of: ep.sections.length, heading: ep.sections[i]!.heading, goal: ep.sections[i]!.goal },
            isFirstSection: i === 0,
            isLastSection: i === ep.sections.length - 1,
            earlierSections: done.slice(0, i).map((d) => d.summary),
            ...(previousLines.length ? { previousLines } : {}),
            targetWords: perSection,
            listenerObjective: state.understanding!.objective,
            ...(revision ? { revision: { instruction: 'Rewrite this section to fix the reviewer\'s problems. Keep what works.', reviewerNotes: revision.notes, problems: revision.problems, previousText: revision.previous } } : {}),
          }, scriptSectionSchema, 6000),
          ep.number,
          `section ${i + 1} of ${ep.sections.length}${revision ? ' (revision)' : ''}`,
        );
        section.segments = ownSpeakers(section.segments);
        // Smaller models often stop short; ask them to continue rather than accept a short episode.
        for (let topUp = 0; topUp < 2; topUp++) {
          const words = section.segments.reduce((n, x) => n + countWords(x.text), 0);
          if (words >= perSection * 0.8) break;
          const tail = section.segments.slice(-3).map((x) => `${x.speaker}: ${x.text}`).join('\n').slice(-1500);
          const more = await runner.run('script', () =>
            chat('script', SCRIPT_TASK, {
              episode: { number: ep.number, title: ep.title, outcomes: ep.outcomes },
              hosts: hostsForPrompt(hosts),
              format,
              showFormat,
              ...listener,
              section: { index: i + 1, of: ep.sections.length, heading: ep.sections[i]!.heading, goal: ep.sections[i]!.goal },
              isLastSection: i === ep.sections.length - 1,
              continueFrom: tail,
              wordsNeeded: perSection - words,
              targetWords: perSection - words,
            }, scriptSectionSchema, 6000),
            ep.number,
            `section ${i + 1} continued`,
          );
          section.segments.push(...ownSpeakers(more.segments));
        }
        done[i] = { segments: section.segments, summary: section.summary };
        await saveState(db, job.id, state);
      };

      for (let i = done.length; i < ep.sections.length; i++) await writeSection(i);

      // Quality gate: review, revise, and only voice a script that passes (or that a person approved).
      const [humanApproval] = await db
        .select({ id: schema.episodeQualityCheck.id })
        .from(schema.episodeQualityCheck)
        .where(and(eq(schema.episodeQualityCheck.episodeId, episodeId), eq(schema.episodeQualityCheck.checkedBy, 'human'), eq(schema.episodeQualityCheck.passed, 1)));
      for (let revision = 1; !humanApproval; revision++) {
        const verdict = await runner.run('validate', async () => {
          const sections = done.map((d) => d.segments);
          const checks = scriptChecks(sections, { targetWords: totalWords, format, hostIds });
          // Review windows must fit the review model's request limit: about 1.4 tokens a word, plus room for instructions and the verdict.
          const limit = (await deps.llm('validate')).requestTokenLimit;
          const windowWords = limit ? Math.max(1000, Math.floor((limit - 2000 - 1500) / 1.4)) : 4500;
          const windows = judgeWindows(sections.map((segs) => segs.reduce((n, x) => n + countWords(x.text), 0)), windowWords);
          const judgements: Judgement[] = [];
          for (const w of windows) {
            judgements.push(
              await chat('validate', VALIDATE_TASK, {
                episode: { title: ep.title, learningObjective: ep.learningObjective, outcomes: ep.outcomes, hook: ep.hook, throughline: ep.throughline, primaryModel: state.models!.find((m) => m.slug === ep.primaryModelSlug)?.name },
                showFormat,
                verifiedBooks: [ep.primaryModelSlug, ...ep.supportingModelSlugs].flatMap((s) => state.research![s]?.books ?? []).map((b) => ({ title: b.title, author: b.authors.join(', ') })),
                format,
                hosts: hostsForPrompt(hosts),
                ...listener,
                sections: w.map((i) => ({ number: i + 1, heading: ep.sections[i]!.heading, text: done[i]!.segments.map((x) => `${x.speaker}: ${x.text}`).join('\n') })),
                windowCoversWholeEpisode: windows.length === 1,
              }, judgementSchema, 2000),
            );
          }
          const agg = aggregateJudgements(judgements);
          const failing = failingCriteria(agg.scores, quality.minScore);
          const passed = failing.length === 0 && checks.length === 0;
          const notes = [...failing.map((c) => `Below standard: ${CRITERIA_LABELS[c]}.`), ...checks.map((c) => c.message), ...agg.problems];
          await db
            .insert(schema.episodeQualityCheck)
            .values({ episodeId, revision, passed: passed ? 1 : 0, scores: agg.scores, notes, checkedBy: 'auto' })
            .onConflictDoUpdate({ target: [schema.episodeQualityCheck.episodeId, schema.episodeQualityCheck.revision], set: { passed: passed ? 1 : 0, scores: agg.scores, notes } });
          return { passed, agg, checks, notes };
        }, ep.number, `review ${revision}`);
        if (verdict.passed) break;
        if (revision > quality.maxRevisions) {
          await db.update(schema.episode).set({ status: 'needs_review', script: done.flatMap((d) => d.segments) }).where(eq(schema.episode.id, episodeId));
          log('episode held for review', { jobId: job.id, episode: ep.number });
          return 'needs_review';
        }
        const wholeScript = verdict.checks.some((c) => c.section === null);
        const targets = new Set<number>(wholeScript ? ep.sections.map((_, i) => i + 1) : [...verdict.agg.sectionsToRevise, ...verdict.checks.map((c) => c.section!).filter(Boolean)]);
        if (targets.size === 0) ep.sections.forEach((_, i) => targets.add(i + 1));
        for (const n of [...targets].filter((n) => n >= 1 && n <= ep.sections.length).sort((a, b) => a - b)) {
          await writeSection(n - 1, { notes: verdict.agg.revisionNotes, problems: verdict.notes, previous: done[n - 1]!.segments.map((x) => x.text).join(' ').slice(0, 6000) });
        }
      }

      const segments = done.flatMap((d) => d.segments);
      const nameOf = (id: string) => hosts.find((h) => h.id === id)?.name ?? 'Host';
      const voiceOf = (id: string) => hosts.find((h) => h.id === id)?.voice ?? options.voices.single;
      await db.update(schema.episode).set({ status: 'synthesizing', script: segments }).where(eq(schema.episode.id, episodeId));
      const workDir = join(deps.workDir, job.id);
      mkdirSync(workDir, { recursive: true });
      const outFile = join(workDir, `${episodeId}.mp3`);
      const audio = await runner.run('synthesize', () =>
        assembleEpisode({
          signal: stop.signal,
          // Section boundaries get a longer breath; the rest of the pacing follows the lines themselves.
          turns: done.flatMap((d, si) => d.segments.map((s, k) => ({ voice: voiceOf(s.speaker), text: s.text, ...(si > 0 && k === 0 ? { sectionBreak: true } : {}) }))),
          pacing: production.pacing,
          expressiveness: production.expressiveness,
          roomTone: production.roomTone,
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
      const transcript = segments.map((s) => (format !== 'single' ? `${nameOf(s.speaker)}: ${s.text}` : s.text)).join('\n\n');
      await db
        .update(schema.episode)
        .set({ status: 'ready', audioKey, audioBytes: audio.bytes, durationSeconds: audio.durationSeconds, transcript })
        .where(eq(schema.episode.id, episodeId));
      await db.insert(schema.usageMetric).values({ metric: 'tts_seconds', provider: deps.tts.name, value: audio.durationSeconds, userId: job.user_id, jobId: job.id });
      await db
        .update(schema.generationJob)
        .set({ audioSecondsGenerated: sql`${schema.generationJob.audioSecondsGenerated} + ${audio.durationSeconds}` })
        .where(eq(schema.generationJob.id, job.id));
      log('episode ready', { jobId: job.id, episode: ep.number, seconds: Math.round(audio.durationSeconds), audioChecks: audio.checks });
      if (options.maxAudioMinutes && audioSeconds / 60 > options.maxAudioMinutes) {
        throw new PermanentJobError(`This series hit its audio budget (${options.maxAudioMinutes} minutes).`);
      }
      return 'ready';
    }

    // 8. Publish
    await runner.checkOwnership();
    await runner.run('publish', async () => {
      await db.update(schema.podcastSeries).set({ status: 'ready' }).where(eq(schema.podcastSeries.id, seriesId!));
      if (options.visibility === 'public' && deps.embedder) {
        // Search indexing is best-effort: a finished series must not be reported as failed because of it.
        try {
          await indexSeriesEmbedding(db, deps.embedder, seriesId!);
        } catch (err) {
          log('search indexing failed', { jobId: job.id, message: err instanceof Error ? err.message : String(err) });
        }
      }
    });
    await db.insert(schema.usageMetric).values({ metric: 'llm_tokens', value: state.tokens ?? 0, userId: job.user_id, jobId: job.id });
    await db
      .update(schema.generationJob)
      .set({ status: 'succeeded', currentStage: 'publish', finishedAt: new Date(), lockedBy: null, lockedUntil: null, error: null, state: state as Record<string, unknown> })
      .where(and(eq(schema.generationJob.id, job.id), eq(schema.generationJob.lockedBy, deps.workerId)));
    return 'succeeded';
  } catch (err) {
    if (err instanceof LostLeaseError || stop.signal.aborted) {
      const [now] = await db.select({ status: schema.generationJob.status }).from(schema.generationJob).where(eq(schema.generationJob.id, job.id));
      if (now?.status === 'cancelled') {
        // The listener cancelled. Tidy again in case anything was written while we stopped.
        if (seriesId) await settleCancelledSeries(db, seriesId);
        log('job cancelled', { jobId: job.id });
        return 'cancelled';
      }
      log('lost lease; another worker owns this job', { jobId: job.id });
      return 'lost_lease';
    }
    const rateLimitedNow = err instanceof LlmError && err.status === 429;
    if (rateLimitedNow) {
      state.rateLimitRetries = (state.rateLimitRetries ?? 0) + 1;
      state.rateLimitedSince ??= Date.now();
    }
    await saveState(db, job.id, state).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof JobCancelledError) {
      await finalise('cancelled', 'Cancelled.');
      return 'cancelled';
    }
    const rateLimited = rateLimitedNow && Date.now() - (state.rateLimitedSince ?? Date.now()) < RATE_LIMIT_PATIENCE_MS;
    if (rateLimitedNow && !rateLimited) {
      const outcome = await finalise('failed', 'The AI service is busy right now (its usage limit was reached). Please try again later.');
      return outcome;
    }
    // A rejected key (401/403) won't fix itself by retrying.
    const rejectedKey = err instanceof LlmError && (err.status === 401 || err.status === 403);
    const permanent = err instanceof PermanentJobError || err instanceof ProviderNotConfiguredError || rejectedKey;
    if (!permanent && (rateLimited || job.attempts < job.max_attempts)) {
      // A daily allowance resets hours later: wait for the time the provider gave (up to 6 hours at a time)
      // instead of using up the retries in an hour.
      const resetSeconds = err instanceof LlmError && err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) + 60 : 0;
      const backoff = Math.min(1800, 60 * 2 ** ((state.rateLimitRetries ?? 1) - 1));
      const delay = rateLimited ? Math.min(21_600, Math.max(backoff, resetSeconds)) : 15 * 2 ** (job.attempts - 1);
      await requeueJob(db, job.id, delay, message, !rateLimited, deps.workerId);
      log('job requeued', { jobId: job.id, attempt: job.attempts, delay, message });
      return 'requeued';
    }
    const outcome = await finalise('failed', userFacingError(err));
    log('job failed', { jobId: job.id, message });
    return outcome;
  } finally {
    clearInterval(watch);
  }

  async function finalise(status: 'failed' | 'cancelled', error: string): Promise<'failed' | 'partial' | 'cancelled'> {
    let final: 'failed' | 'partial' | 'cancelled' = status;
    if (seriesId && status === 'cancelled') {
      await settleCancelledSeries(db, seriesId);
    } else if (seriesId) {
      const ready = await db
        .select({ id: schema.episode.id })
        .from(schema.episode)
        .where(and(eq(schema.episode.seriesId, seriesId), eq(schema.episode.status, 'ready')));
      if (status === 'failed' && ready.length > 0) final = 'partial';
      await db
        .update(schema.episode)
        .set({ status: 'failed' })
        .where(and(eq(schema.episode.seriesId, seriesId), inArray(schema.episode.status, ['pending', 'scripting', 'validating', 'synthesizing'])));
      await db.update(schema.podcastSeries).set({ status: final }).where(eq(schema.podcastSeries.id, seriesId));
    }
    await db
      .update(schema.generationJob)
      .set({ status: final, error, finishedAt: new Date(), lockedBy: null, lockedUntil: null })
      .where(and(eq(schema.generationJob.id, job.id), eq(schema.generationJob.lockedBy, deps.workerId)));
    return final;
  }
}

function userFacingError(err: unknown): string {
  if (err instanceof ProviderNotConfiguredError) return `Podcast generation isn't configured yet: ${err.message}`;
  if (err instanceof PermanentJobError) return err.message;
  if (err instanceof LlmError && (err.status === 401 || err.status === 403)) {
    return "The AI service rejected ThinkMade's access key, so this podcast couldn't be made. An administrator needs to update the key; then please try again.";
  }
  if (err instanceof LlmError) return 'The language model service failed repeatedly. Please try again later.';
  return `Something went wrong while building your podcasts: ${err instanceof Error ? err.message : String(err)}`;
}
