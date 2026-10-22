import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('carries the official name and tagline', () => {
    expect(BRAND.name).toBe('ThinkMade');
    expect(BRAND.tagline).toBe('Better Thinking. Made Personal.');
    expect(BRAND.promise).toBe("Don't just learn more. Learn to think better.");
    expect(BRAND.shortDescription).toBe('Personalized podcasts that teach you how to think.');
  });

  it('uses the five brand colors', () => {
    expect(BRAND.colors).toEqual({
      warmIvory: '#F7F4EE',
      deepCharcoal: '#292929',
      terracotta: '#C56B4E',
      sageGreen: '#829284',
      softWhite: '#FFFFFF',
    });
  });
});
