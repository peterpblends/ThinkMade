import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { assembleEpisode, completeJson, type ChatMessage } from '@thinkmade/ai';
import { schema, type Db } from '@thinkmade/db';
import {
  chooseHosts,
  DEFAULT_APP_SETTINGS,
  DEFAULT_PRODUCTION,
  input,
  languageInstruction,
  languageLabel,
  stageSystem,
  TRANSLATE_SCRIPT_TASK,
  translatedScriptSchema,
  voiceInfo,
  type GenerationOptions,
  type HostId,
} from '@thinkmade/shared';
import type { WorkerDeps } from './deps';

type Line = { speaker: string; text: string };

/** Script lines go to the language model in groups of about this many characters. */
const CHUNK_CHARS = 5000;

function chunks(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  let cur: Line[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.text.length > CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Voices an existing series in another language, episode by episode: translates each script (keeping every
 * line and speaker), casts each host a native voice of that language (same name, same gender where there is
 * one), and records the audio. Episodes already voiced are skipped, so a run stopped by a rate limit resumes.
 * An episode that can't be done is marked failed and the rest carry on.
 */
export async function voiceTranslation(opts: {
  db: Db;
  deps: WorkerDeps;
  seriesId: string;
  options: GenerationOptions;
  signal: AbortSignal;
  onTokens: (n: number) => void;
  keepAlive: () => Promise<void>;
  log: (message: string, extra?: Record<string, unknown>) => void;
}): Promise<{ voiced: number; failed: number }> {
  const { db, deps, seriesId, options, signal } = opts;
  const language = options.translate!.language;
  const rows = await db
    .select({ episode: schema.episode, translation: schema.episodeTranslation })
    .from(schema.episodeTranslation)
    .innerJoin(schema.episode, eq(schema.episode.id, schema.episodeTranslation.episodeId))
    .where(and(eq(schema.episode.seriesId, seriesId), eq(schema.episodeTranslation.language, language), inArray(schema.episodeTranslation.status, ['voicing'])));
  const [series] = await db.select({ title: schema.podcastSeries.title }).from(schema.podcastSeries).where(eq(schema.podcastSeries.id, seriesId));
  const production = { ...DEFAULT_PRODUCTION, ...options.production };
  const pool = options.voicePool ?? DEFAULT_APP_SETTINGS.voices.available;
  const rule = languageInstruction(language);
  const llm = await deps.llm('script');
  let voiced = 0;
  let failed = 0;

  for (const { episode: ep, translation: t } of rows.sort((a, b) => a.episode.number - b.episode.number)) {
    // The script in the new language (kept once made, so a retry or a resumed run doesn't translate it again).
    let script = t.script;
    // An episode that errors is started over from the step that failed, once, before it is marked failed.
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        // 1. The script in the new language.
        if (!script?.length) {
          const original = ep.script ?? [];
          if (!original.length) throw new Error('This episode has no script to translate.');
          const names = Object.fromEntries((ep.hosts ?? []).map((h) => [h.id, h.name]));
          script = [];
          for (const part of chunks(original)) {
            let lines: Line[] | null = null;
            for (let attempt = 0; attempt < 2 && !lines; attempt++) {
              const messages: ChatMessage[] = [
                { role: 'system', content: stageSystem('translate', `${TRANSLATE_SCRIPT_TASK}${rule ? `\n\n${rule}` : ''}`) },
                {
                  role: 'user',
                  content: input({
                    targetLanguage: languageLabel(language),
                    seriesTitle: series?.title,
                    episodeTitle: ep.title,
                    speakers: names,
                    lineCount: part.length,
                    segments: part,
                  }),
                },
              ];
              const res = await completeJson(llm, messages, translatedScriptSchema, { temperature: 0.3, maxTokens: 6000, signal });
              opts.onTokens(res.usage.promptTokens + res.usage.completionTokens);
              // Every line must come back, by the same speaker; otherwise ask again.
              if (res.data.segments.length === part.length) lines = res.data.segments.map((s, i) => ({ speaker: part[i]!.speaker, text: s.text }));
            }
            if (!lines) throw new Error('The translation dropped or added lines.');
            script.push(...lines);
            await opts.keepAlive();
          }
          await db
            .update(schema.episodeTranslation)
            .set({ script, transcript: script.map((l) => `${names[l.speaker] ?? l.speaker}: ${l.text}`).join('\n\n'), updatedAt: new Date() })
            .where(and(eq(schema.episodeTranslation.episodeId, ep.id), eq(schema.episodeTranslation.language, language)));
        }

        // 2. Native voices for the hosts: same names, same gender where the language has one.
        const hosts = ep.hosts ?? [];
        const cast = chooseHosts({
          count: hosts.length,
          language,
          pool,
          requested: hosts.map((h) => ({ name: h.name, gender: voiceInfo(h.voice)?.gender ?? null })),
          ids: hosts.map((h) => h.id as HostId),
          ...(options.voiceProfiles ? { profiles: options.voiceProfiles } : {}),
        });
        const voiceOf = new Map<string, string>(cast.map((h) => [h.id, h.voice]));

        // 3. The audio.
        const dir = join(deps.workDir, `translate-${ep.id}-${language}`);
        mkdirSync(dir, { recursive: true });
        try {
          const outFile = join(dir, 'episode.mp3');
          const audio = await assembleEpisode({
            signal,
            turns: script.map((l) => ({ voice: voiceOf.get(l.speaker) ?? cast[0]!.voice, text: l.text })),
            pacing: production.pacing,
            expressiveness: production.expressiveness,
            roomTone: production.roomTone,
            natural: options.naturalDelivery === true,
            language,
            tts: deps.tts,
            outFile,
            workDir: dir,
            bitrateKbps: options.bitrateKbps,
            onProgress: opts.keepAlive,
          });
          const audioKey = `audio/${seriesId}/${ep.id}-${language}.mp3`;
          await deps.storage.putFile(audioKey, outFile, 'audio/mpeg');
          await db
            .update(schema.episodeTranslation)
            .set({ status: 'ready', audioKey, audioBytes: audio.bytes, durationSeconds: audio.durationSeconds, hosts: cast.map((h) => ({ id: h.id, name: h.name, voice: h.voice })), updatedAt: new Date() })
            .where(and(eq(schema.episodeTranslation.episodeId, ep.id), eq(schema.episodeTranslation.language, language)));
          voiced++;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        break;
      } catch (err) {
        // Rate limits and cancellation stop the whole run (it resumes later); anything else fails this episode only.
        if (signal.aborted || (err as { status?: number }).status === 429) throw err;
        if (attempt < 1) {
          opts.log('translation step failed; starting it over', { episodeId: ep.id, language, message: err instanceof Error ? err.message : String(err) });
          continue;
        }
        opts.log('translation failed', { episodeId: ep.id, language, message: err instanceof Error ? err.message : String(err) });
        await db
          .update(schema.episodeTranslation)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(schema.episodeTranslation.episodeId, ep.id), eq(schema.episodeTranslation.language, language)));
        failed++;
        break;
      }
    }
  }
  return { voiced, failed };
}
