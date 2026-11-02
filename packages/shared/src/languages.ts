/**
 * Languages podcasts can be made in. English uses every voice; the others use native voices that can speak
 * them (see `speaks` on each voice). `espeak` is the eSpeak NG voice the worker uses to turn text into the
 * sounds Kokoro speaks.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', espeak: null, speech: 'en-US' },
  { code: 'es', name: 'Spanish', native: 'Español', espeak: 'es-419', speech: 'es-MX' },
  { code: 'fr', name: 'French', native: 'Français', espeak: 'fr-fr', speech: 'fr-FR' },
  { code: 'pt-br', name: 'Portuguese (Brazil)', native: 'Português (Brasil)', espeak: 'pt-br', speech: 'pt-BR' },
  { code: 'it', name: 'Italian', native: 'Italiano', espeak: 'it', speech: 'it-IT' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', espeak: 'hi', speech: 'hi-IN' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as unknown as readonly [LanguageCode, ...LanguageCode[]];

export function languageInfo(code: string | null | undefined): (typeof LANGUAGES)[number] {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** How a language is named in instructions to the language model, e.g. "Spanish (Español)". */
export function languageLabel(code: string): string {
  const l = languageInfo(code);
  return l.code === 'en' ? 'English' : `${l.name} (${l.native})`;
}

/**
 * The instruction added to every language-model stage of a podcast in another language: everything a
 * listener reads or hears is written in that language; the structure stays as it is.
 */
export function languageInstruction(code: string): string | null {
  if (languageInfo(code).code === 'en') return null;
  const label = languageLabel(code);
  return (
    `LANGUAGE: This podcast is in ${label}. Write every word the listener will read or hear in natural, fluent ${label} as a native speaker would say it: ` +
    'titles, descriptions, objectives, outcomes, takeaways, examples, section headings, mental model names and summaries, and the spoken script. ' +
    'Keep JSON keys, slugs, speaker letters and enumerated values exactly as specified, and give book titles as published. ' +
    'When reviewing, judge the text as it reads in that language.'
  );
}

/** What a voice says in its sample, in each language. */
export const SAMPLE_LINES: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Hi, I'm ${n}. Let's think this through together, one idea at a time, and find what really matters.`,
  es: (n) => `Hola, soy ${n}. Pensemos esto juntos, una idea a la vez, y encontremos lo que realmente importa.`,
  fr: (n) => `Bonjour, je suis ${n}. Réfléchissons-y ensemble, une idée à la fois, et trouvons ce qui compte vraiment.`,
  'pt-br': (n) => `Oi, eu sou ${n}. Vamos pensar nisso juntos, uma ideia de cada vez, e descobrir o que realmente importa.`,
  it: (n) => `Ciao, sono ${n}. Pensiamoci insieme, un'idea alla volta, e troviamo ciò che conta davvero.`,
  hi: (n) => `नमस्ते, मैं ${n} हूँ। चलिए इसे साथ मिलकर सोचते हैं, एक-एक विचार करके, और समझते हैं कि असल में क्या मायने रखता है।`,
};
