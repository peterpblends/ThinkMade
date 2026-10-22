import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, appSettingsPatchSchema, appSettingsSchema } from './settings';

describe('app settings', () => {
  it('default settings parse against the schema and match the spec defaults', () => {
    const parsed = appSettingsSchema.parse(DEFAULT_APP_SETTINGS);
    expect(parsed.podcast.defaultLengthMinutes).toBe(15);
    expect(parsed.podcast.defaultEpisodes).toBe(3);
    expect(parsed.podcast.speakerFormat).toBe('mixed');
    expect(parsed.podcast.learningMode).toBe('explore');
    expect(parsed.podcast.visibility).toBe('private');
    expect(parsed.podcast.language).toBe('en');
    expect(parsed.podcast.maxEpisodeMinutes).toBe(60);
  });

  it('rejects a default length above the maximum episode length', () => {
    const result = appSettingsSchema.safeParse({
      ...DEFAULT_APP_SETTINGS,
      podcast: { ...DEFAULT_APP_SETTINGS.podcast, defaultLengthMinutes: 90 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a partial patch', () => {
    const patch = appSettingsPatchSchema.parse({ podcast: { defaultEpisodes: 5 } });
    expect(patch).toEqual({ podcast: { defaultEpisodes: 5 } });
  });

  it('rejects a patch with an unknown key', () => {
    expect(appSettingsPatchSchema.safeParse({ podcast: { bogus: 1 } }).success).toBe(false);
  });
});

describe('applySettingsPatch', () => {
  it('merges a patch section by section without touching other sections', async () => {
    const { applySettingsPatch } = await import('./settings');
    const next = applySettingsPatch(DEFAULT_APP_SETTINGS, { podcast: { defaultEpisodes: 5 } });
    expect(next.podcast.defaultEpisodes).toBe(5);
    expect(next.podcast.defaultLengthMinutes).toBe(15);
    expect(next.voices).toEqual(DEFAULT_APP_SETTINGS.voices);
  });

  it('throws when the merged result is invalid', async () => {
    const { applySettingsPatch } = await import('./settings');
    expect(() => applySettingsPatch(DEFAULT_APP_SETTINGS, { podcast: { defaultEpisodes: 0 } })).toThrow();
  });
});
