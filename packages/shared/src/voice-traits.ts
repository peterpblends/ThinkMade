/**
 * How each voice sounds, measured from the real voices by the audio probe (Actions → Audio probe): median
 * pitch in Hz and timbre as 16 band levels in dB (100 Hz to 11 kHz, relative to the voice's total). Used to
 * cast hosts of the same gender whose voices are clearly different, not two takes of what sounds like one
 * person.
 */
export const VOICE_TRAITS: Record<string, { pitchHz: number; timbre: number[] }> = {};

/**
 * How different two voices sound: semitones apart in pitch plus the mean difference of their timbre in dB.
 * Null when either hasn't been measured.
 */
export function voiceDistance(a: string, b: string): number | null {
  const x = VOICE_TRAITS[a];
  const y = VOICE_TRAITS[b];
  if (!x || !y || !x.pitchHz || !y.pitchHz) return null;
  const semitones = Math.abs(12 * Math.log2(x.pitchHz / y.pitchHz));
  const timbre = x.timbre.reduce((n, v, i) => n + Math.abs(v - (y.timbre[i] ?? v)), 0) / Math.max(1, x.timbre.length);
  return semitones + timbre;
}

/** Below this, two voices are heard as the same person (or near enough to confuse a listener). */
export const DISTINCT_VOICES = 3;

/** Whether two voices sound too alike to be two different people in one show. Unmeasured voices pass. */
export function soundAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const d = voiceDistance(a, b);
  return d !== null && d < DISTINCT_VOICES;
}
