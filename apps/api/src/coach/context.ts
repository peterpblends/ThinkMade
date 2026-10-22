/** Picks the transcript passages most relevant to the question, within a word budget. */
export function selectExcerpts(transcript: string, query: string, maxWords = 1200, chunkWords = 220): string[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.length ? [words.join(' ')] : [];
  const chunks: Array<{ i: number; text: string }> = [];
  for (let i = 0; i < words.length; i += chunkWords) chunks.push({ i, text: words.slice(i, i + chunkWords).join(' ') });
  const terms = new Set(query.toLowerCase().match(/[a-z0-9']{4,}/g) ?? []);
  const scored = chunks.map((c) => {
    const tokens = c.text.toLowerCase().match(/[a-z0-9']{4,}/g) ?? [];
    const hits = tokens.filter((t) => terms.has(t)).length;
    return { ...c, score: hits / Math.sqrt(tokens.length || 1) + (c.i === 0 ? 0.01 : 0) };
  });
  const take = Math.max(1, Math.floor(maxWords / chunkWords));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .sort((a, b) => a.i - b.i)
    .map((c) => c.text);
}

export { COACH_INSTRUCTIONS } from '@thinkmade/shared';
