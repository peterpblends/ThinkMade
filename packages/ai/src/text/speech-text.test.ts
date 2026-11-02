import { describe, expect, it } from 'vitest';
import { toSpeechText } from './speech-text';

describe('toSpeechText', () => {
  it('drops markdown and stage directions', () => {
    expect(toSpeechText('**Wait** — really? [laughs] (pause) Okay.')).toBe('Wait, really? Okay.');
  });
  it('spells out symbols and abbreviations', () => {
    expect(toSpeechText('About 40% of teams, e.g. ours, fail vs. plan & budget.')).toBe('About 40 percent of teams, for example, ours, fail versus plan and budget.');
  });
  it('turns dashes and ellipses into pauses without doubling punctuation', () => {
    expect(toSpeechText('So… the real question - why?')).toBe('So, the real question, why?');
    expect(toSpeechText('It works—.')).toBe('It works.');
  });
});

describe('speech text in other languages', () => {
  it('leaves abbreviations to the engine and keeps the language’s own punctuation', () => {
    expect(toSpeechText('Por ejemplo, el 50% (pausa) de la gente…', 'es')).toBe('Por ejemplo, el 50% de la gente,');
    expect(toSpeechText('etc. & more', 'fr')).toBe('etc. & more');
    expect(toSpeechText('etc. & more')).toBe('and so on and more');
  });
});
