export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Splits text into speakable chunks of at most `maxChars`, preferring sentence boundaries,
 * then word boundaries. Keeps every word, in order.
 */
export function splitForSpeech(text: string, maxChars = 350): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  const pushWords = (s: string) => {
    for (const word of s.split(' ')) {
      if (!word) continue;
      if ((current ? current.length + 1 : 0) + word.length > maxChars) {
        if (current) chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
  };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxChars) {
      pushWords(s);
      continue;
    }
    if ((current ? current.length + 1 : 0) + s.length > maxChars) {
      if (current) chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
