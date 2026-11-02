import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { EPISODE_COUNT_CHOICES, languageInfo, PODCAST_LENGTH_CHOICES, usableVoices, VOICE_SAMPLE_MANIFEST_KEY, voiceInfo, voiceSampleEntry, voiceSampleKey } from '@thinkmade/shared';
import type { AppContext } from '../create-context';

/** The voices with a rendered sample, read from the worker's manifest and kept for a few minutes. */
function sampleIndex(ctx: AppContext) {
  let cached: { at: number; voices: Set<string> } | null = null;
  return async (): Promise<Set<string>> => {
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.voices;
    let voices = new Set<string>();
    try {
      const obj = await ctx.storage.get(VOICE_SAMPLE_MANIFEST_KEY);
      const chunks: Buffer[] = [];
      for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { voices?: unknown };
      if (Array.isArray(parsed.voices)) voices = new Set(parsed.voices.filter((v): v is string => typeof v === 'string'));
    } catch {
      // No samples rendered yet.
    }
    cached = { at: Date.now(), voices };
    return voices;
  };
}

/** Settings any visitor may read: what the Create screen needs, nothing operational. */
export function publicSettingsRoutes(ctx: AppContext) {
  const samples = sampleIndex(ctx);
  return new Hono()
    .get('/settings/public', async (c) => {
      const { settings } = await ctx.settings.getActive();
      const p = settings.podcast;
      const withSample = await samples();
      return c.json({
        podcast: {
          defaultLengthMinutes: p.defaultLengthMinutes,
          defaultEpisodes: p.defaultEpisodes,
          maxEpisodeMinutes: p.maxEpisodeMinutes,
          maxEpisodesPerSeries: p.maxEpisodesPerSeries,
          speakerFormat: p.speakerFormat,
          learningMode: p.learningMode,
          visibility: p.visibility,
          lengthChoices: PODCAST_LENGTH_CHOICES.filter((m) => m <= p.maxEpisodeMinutes),
          episodeChoices: EPISODE_COUNT_CHOICES.filter((n) => n <= p.maxEpisodesPerSeries),
        },
        media: settings.media,
        splash: { seconds: settings.appearance.splashSeconds },
        features: settings.features,
        // Voices listeners may pick for their hosts, with a sample to hear where one has been rendered.
        voices: usableVoices(settings).flatMap((id) => {
          const v = voiceInfo(id);
          if (!v) return [];
          const url = (lang: string) => `/api/voices/${encodeURIComponent(id)}/sample${lang === 'en' ? '' : `?lang=${lang}`}`;
          // A sample in each language the voice speaks (English as sampleUrl, as before).
          const sampleUrls = Object.fromEntries(v.speaks.filter((l) => withSample.has(voiceSampleEntry(id, l))).map((l) => [l, url(l)]));
          return [{ id, name: v.name, accent: v.accent, gender: v.gender, speaks: v.speaks, ...(v.heritage ? { heritage: v.heritage } : {}), ...(sampleUrls.en ? { sampleUrl: sampleUrls.en } : {}), sampleUrls }];
        }),
      });
    })
    // A short spoken sample of a voice, so listeners can hear it before choosing it.
    .get('/voices/:id/sample', async (c) => {
      const id = c.req.param('id');
      const { settings } = await ctx.settings.getActive();
      const lang = languageInfo(c.req.query('lang')).code;
      if (!voiceInfo(id)?.speaks.includes(lang) || !usableVoices(settings).includes(id)) return c.json({ error: 'not_found' }, 404);
      const key = voiceSampleKey(id, lang);
      const head = await ctx.storage.head(key);
      if (!head) return c.json({ error: 'not_ready', message: "This voice's sample isn't ready yet." }, 404);
      if (ctx.storage.presignGet) {
        c.header('Cache-Control', 'public, max-age=3600');
        return c.redirect(await ctx.storage.presignGet(key, 6 * 3600), 302);
      }
      const obj = await ctx.storage.get(key);
      return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(obj.size), 'Cache-Control': 'public, max-age=86400' },
      });
    });
}
