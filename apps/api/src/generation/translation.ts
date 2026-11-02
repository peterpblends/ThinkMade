import { and, asc, eq, inArray } from 'drizzle-orm';
import { completeJson, type ChatMessage } from '@thinkmade/ai';
import { schema } from '@thinkmade/db';
import { input, languageInfo, languageLabel, speaksLanguage, stageSystem, TRANSLATE_TEXT_TASK, translatedTextSchema, usableVoices, type GenerationOptions, type TranslatedText } from '@thinkmade/shared';
import type { AppContext } from '../create-context';

type Series = typeof schema.podcastSeries.$inferSelect;
type Episode = typeof schema.episode.$inferSelect;
type EpisodeTranslation = typeof schema.episodeTranslation.$inferSelect;

export class LanguageSwitchError extends Error {
  constructor(
    readonly status: 400 | 403 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The language a series is shown in, its text in that language, and the versions that exist. */
export async function languageView(ctx: AppContext, s: Series, episodeIds: string[]) {
  const language = s.language;
  const versions = await ctx.db.select({ language: schema.seriesTranslation.language }).from(schema.seriesTranslation).where(eq(schema.seriesTranslation.seriesId, s.id));
  const [text] = language === s.originalLanguage ? [] : await ctx.db.select().from(schema.seriesTranslation).where(and(eq(schema.seriesTranslation.seriesId, s.id), eq(schema.seriesTranslation.language, language)));
  const episodes =
    language === s.originalLanguage || !episodeIds.length
      ? []
      : await ctx.db.select().from(schema.episodeTranslation).where(and(inArray(schema.episodeTranslation.episodeId, episodeIds), eq(schema.episodeTranslation.language, language)));
  return {
    language,
    originalLanguage: s.originalLanguage,
    languages: [s.originalLanguage, ...versions.map((v) => v.language).filter((l) => l !== s.originalLanguage)],
    title: text?.title ?? s.title,
    description: text?.description ?? s.description,
    episodes: new Map(episodes.map((e) => [e.episodeId, e])),
  };
}

/**
 * An episode as shown in another language: its translated text, and its audio in that language once voiced
 * (until then the original audio plays, and audioLanguage says so).
 */
export function inLanguage<T extends { id: string; title: string; description: string; audioUrl: string | null }>(ep: T, t: EpisodeTranslation | undefined, original: string) {
  if (!t) return { ...ep, audioLanguage: original, languageStatus: 'ready' as const };
  const voiced = t.status === 'ready' && !!t.audioKey;
  return {
    ...ep,
    title: t.title,
    description: t.description,
    learningObjective: t.learningObjective,
    outcomes: t.outcomes,
    keyTakeaways: t.keyTakeaways,
    examples: t.examples,
    ...(t.durationSeconds && voiced ? { durationSeconds: t.durationSeconds } : {}),
    ...(t.hosts?.length && voiced ? { hosts: t.hosts.map((h) => ({ name: h.name })) } : {}),
    audioUrl: voiced ? `/api/episodes/${ep.id}/audio?lang=${encodeURIComponent(t.language)}` : ep.audioUrl,
    audioLanguage: voiced ? t.language : original,
    languageStatus: t.status === 'ready' ? ('ready' as const) : t.status === 'failed' ? ('failed' as const) : ('voicing' as const),
  };
}

/** Translates a series' text with the language model, a few episodes per request (in parallel). */
async function translateText(ctx: AppContext, s: Series, eps: Episode[], language: string): Promise<TranslatedText> {
  const llm = await ctx.llm('validate');
  const batches: Episode[][] = [];
  for (let i = 0; i < Math.max(1, eps.length); i += 4) batches.push(eps.slice(i, i + 4));
  const parts = await Promise.all(
    batches.map(async (batch, i) => {
      const messages: ChatMessage[] = [
        { role: 'system', content: stageSystem('translate', TRANSLATE_TEXT_TASK) },
        {
          role: 'user',
          content: input({
            targetLanguage: languageLabel(language),
            series: i === 0 ? { title: s.title, description: s.description } : { title: s.title, description: '' },
            episodes: batch.map((e) => ({ id: e.id, title: e.title, description: e.description, learningObjective: e.learningObjective, outcomes: e.outcomes, keyTakeaways: e.keyTakeaways, examples: e.examples })),
          }),
        },
      ];
      return (await completeJson(llm, messages, translatedTextSchema, { temperature: 0.2, maxTokens: 4000 })).data;
    }),
  );
  return { series: parts[0]!.series, episodes: parts.flatMap((p) => p.episodes) };
}

/**
 * Shows a series in another language. A language it already has (or its original) switches at once. A new one
 * has its text translated now and switches at once; its audio is voiced by the worker in the background,
 * and each episode plays in the original language until its new audio is ready.
 */
export async function switchLanguage(ctx: AppContext, s: Series, requested: string): Promise<{ voicing: boolean }> {
  const language = languageInfo(requested).code;
  if (language !== requested) throw new LanguageSwitchError(400, 'invalid_language', 'That language isn’t available.');
  const { settings } = await ctx.settings.getActive();
  if (language === s.originalLanguage) {
    await ctx.db.update(schema.podcastSeries).set({ language }).where(eq(schema.podcastSeries.id, s.id));
    return { voicing: false };
  }
  if (!settings.features.languages) throw new LanguageSwitchError(403, 'feature_off', 'Other languages are turned off right now.');
  if (!usableVoices(settings).some((v) => speaksLanguage(v, language))) throw new LanguageSwitchError(400, 'no_voices', `No voices are available for ${languageLabel(language)} right now.`);
  if (!['ready', 'partial'].includes(s.status)) throw new LanguageSwitchError(409, 'not_ready', 'This series can change language once it is finished.');

  const eps = (await ctx.db.select().from(schema.episode).where(eq(schema.episode.seriesId, s.id)).orderBy(asc(schema.episode.number))).filter((e) => e.status === 'ready');
  // Each host needs a voice of their own in the new language.
  const voices = usableVoices(settings).filter((v) => speaksLanguage(v, language)).length;
  const hosts = Math.max(1, ...eps.map((e) => e.hosts?.length ?? 1));
  if (voices < hosts) {
    throw new LanguageSwitchError(400, 'not_enough_voices', `${languageLabel(language)} has ${voices} voice${voices === 1 ? '' : 's'}, not enough for this podcast's ${hosts} hosts.`);
  }
  const have = new Set(
    eps.length
      ? (await ctx.db.select({ id: schema.episodeTranslation.episodeId }).from(schema.episodeTranslation).where(and(inArray(schema.episodeTranslation.episodeId, eps.map((e) => e.id)), eq(schema.episodeTranslation.language, language)))).map((r) => r.id)
      : [],
  );
  const [existing] = await ctx.db.select().from(schema.seriesTranslation).where(and(eq(schema.seriesTranslation.seriesId, s.id), eq(schema.seriesTranslation.language, language)));
  const missing = eps.filter((e) => !have.has(e.id));
  if (existing && !missing.length) {
    await ctx.db.update(schema.podcastSeries).set({ language }).where(eq(schema.podcastSeries.id, s.id));
    return { voicing: false };
  }

  let text: TranslatedText;
  try {
    text = await translateText(ctx, s, missing, language);
  } catch (err) {
    console.error('[language] translation failed', err instanceof Error ? err.message : err);
    throw new LanguageSwitchError(502, 'translation_failed', 'The translation could not be made just now. Please try again in a moment.');
  }
  if (!existing) await ctx.db.insert(schema.seriesTranslation).values({ seriesId: s.id, language, title: text.series.title, description: text.series.description }).onConflictDoNothing();
  const byId = new Map(text.episodes.map((t) => [t.id, t]));
  for (const e of missing) {
    const t = byId.get(e.id);
    await ctx.db
      .insert(schema.episodeTranslation)
      .values({
        episodeId: e.id,
        language,
        title: t?.title ?? e.title,
        description: t?.description ?? e.description,
        learningObjective: t?.learningObjective ?? e.learningObjective,
        outcomes: t?.outcomes ?? e.outcomes,
        keyTakeaways: t?.keyTakeaways ?? e.keyTakeaways,
        examples: (t?.examples as Array<Record<string, unknown>> | undefined) ?? e.examples,
        status: 'voicing',
      })
      .onConflictDoNothing();
  }
  await ctx.db.update(schema.podcastSeries).set({ language }).where(eq(schema.podcastSeries.id, s.id));

  // Voice the new language in the background, with the series' own settings.
  const [first] = await ctx.db.select({ options: schema.generationJob.options }).from(schema.generationJob).where(eq(schema.generationJob.seriesId, s.id)).orderBy(asc(schema.generationJob.createdAt)).limit(1);
  const options = { ...(first?.options as unknown as GenerationOptions), voicePool: usableVoices(settings), language, translate: { language } };
  await ctx.db.insert(schema.generationJob).values({ userId: s.userId, learningRequestId: s.learningRequestId, seriesId: s.id, options: options as unknown as Record<string, unknown> });
  ctx.pokeWorker();
  return { voicing: true };
}
