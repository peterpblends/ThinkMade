import { describe, expect, it } from 'vitest';
import { chooseHosts } from './hosts';
import { languageInstruction, LANGUAGES, SAMPLE_LINES } from './languages';
import { DEFAULT_APP_SETTINGS, speaksLanguage, voiceInfo, voiceSampleEntry, voiceSampleKey, voiceSampleText, VOICE_CATALOG } from './settings';

const pool = DEFAULT_APP_SETTINGS.voices.available;

describe('languages', () => {
  it('every language has native voices of its own, and a sample line', () => {
    for (const l of LANGUAGES) {
      expect(VOICE_CATALOG.some((v) => v.speaks.includes(l.code)), l.code).toBe(true);
      expect(SAMPLE_LINES[l.code]('Ana')).toContain('Ana');
    }
  });

  it('asks the language model to write for the listener in the language, keeping the structure', () => {
    expect(languageInstruction('en')).toBeNull();
    expect(languageInstruction('es')).toMatch(/This podcast is in Spanish \(Español\)/);
    expect(languageInstruction('es')).toMatch(/Keep JSON keys, slugs, speaker letters/);
  });

  it('casts only voices that speak the language', () => {
    for (let i = 0; i < 10; i++) {
      const es = chooseHosts({ count: 2, pool, language: 'es' });
      expect(es.map((h) => h.voice).sort()).toEqual(['ef_dora', 'em_alex']);
      const hi = chooseHosts({ count: 2, pool, language: 'hi', gender: 'female' });
      expect(hi.every((h) => voiceInfo(h.voice)!.speaks.includes('hi') && voiceInfo(h.voice)!.gender === 'female')).toBe(true);
    }
    expect(chooseHosts({ count: 1, pool, language: 'fr' })[0]!.voice).toBe('ff_siwis');
    expect(chooseHosts({ count: 1, pool, language: 'pt-br', gender: 'male' })[0]!.voice).toBe('pm_alex');
  });

  it("keeps English casting as it was: voices for other languages don't speak English", () => {
    for (let i = 0; i < 20; i++) for (const h of chooseHosts({ count: 2, pool })) expect(speaksLanguage(h.voice, 'en')).toBe(true);
    expect(speaksLanguage('ff_siwis', 'en')).toBe(false);
    expect(speaksLanguage('ef_dora', 'en')).toBe(true);
  });

  it('keeps English samples where they were and gives other languages their own', () => {
    expect(voiceSampleKey('ef_dora')).toBe('voice-samples/v1/ef_dora.mp3');
    expect(voiceSampleKey('ef_dora', 'es')).toBe('voice-samples/v1/es/ef_dora.mp3');
    expect(voiceSampleEntry('ef_dora', 'es')).toBe('es:ef_dora');
    expect(voiceSampleText('Dora', 'es')).toMatch(/^Hola, soy Dora\./);
  });
});
