import { describe, expect, it } from 'vitest';
import { countWords, splitForSpeech } from './split';

describe('splitForSpeech', () => {
  it('keeps short text whole', () => {
    expect(splitForSpeech('Hello there. How are you?')).toEqual(['Hello there. How are you?']);
  });

  it('splits long text at sentence boundaries under the limit', () => {
    const sentence = 'This is a sentence with several words in it. ';
    const chunks = splitForSpeech(sentence.repeat(30), 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.trim().endsWith('.')).toBe(true);
    }
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(sentence.repeat(30).trim());
  });

  it('hard-wraps a single overlong sentence at word boundaries', () => {
    const chunks = splitForSpeech('word '.repeat(200).trim(), 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it('counts words', () => {
    expect(countWords("It's a fine day, isn't it?")).toBe(6);
  });
});
