import { Hono } from 'hono';
import { EPISODE_COUNT_CHOICES, PODCAST_LENGTH_CHOICES, voiceInfo } from '@thinkmade/shared';
import type { AppContext } from '../create-context';

/** Settings any visitor may read: what the Create screen needs, nothing operational. */
export function publicSettingsRoutes(ctx: AppContext) {
  return new Hono().get('/settings/public', async (c) => {
    const { settings } = await ctx.settings.getActive();
    const p = settings.podcast;
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
      // Voices listeners may pick for their hosts.
      voices: settings.voices.available.flatMap((id) => {
        const v = voiceInfo(id);
        return v ? [{ id, name: v.name, accent: v.accent, gender: v.gender }] : [];
      }),
    });
  });
}
