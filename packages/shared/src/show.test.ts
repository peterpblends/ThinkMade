import { describe, expect, it } from 'vitest';
import { castHosts, chooseShowFormat, episodeShowFormat } from './show';
import { DEFAULT_PRODUCTION } from './settings';

const auto = DEFAULT_PRODUCTION;

describe('chooseShowFormat', () => {
  it('tells one host as a story, whatever else is asked', () => {
    expect(chooseShowFormat({ speakerFormat: 'single', production: auto, requested: 'interview', suggested: 'conversation' })).toBe('storytelling');
  });
  it("puts the listener's request first, then the administrator, then the topic", () => {
    const admin = { ...auto, showFormat: 'conversation' as const };
    expect(chooseShowFormat({ speakerFormat: 'two_hosts', production: admin, requested: 'interview', suggested: 'storytelling' })).toBe('interview');
    expect(chooseShowFormat({ speakerFormat: 'two_hosts', production: admin, suggested: 'interview' })).toBe('conversation');
    expect(chooseShowFormat({ speakerFormat: 'mixed', production: auto, suggested: 'interview' })).toBe('interview');
    expect(chooseShowFormat({ speakerFormat: 'two_hosts', production: auto })).toBe('conversation');
  });
  it('never runs an interview with simulated guests switched off', () => {
    expect(chooseShowFormat({ speakerFormat: 'two_hosts', production: { ...auto, allowSimulatedGuests: false }, requested: 'interview' })).toBe('conversation');
  });
  it('tells the single-host episodes of a mixed series as stories', () => {
    expect(episodeShowFormat('interview', 1)).toBe('storytelling');
    expect(episodeShowFormat('interview', 2)).toBe('interview');
    expect(episodeShowFormat('storytelling', 2)).toBe('conversation');
  });
});

describe('castHosts', () => {
  const host = (id: 'A' | 'B' | 'C', extra = {}) => ({ id, name: id, voice: `v${id}`, ...extra });

  it('gives undescribed hosts distinct, complementary parts, plus any house style', () => {
    const cast = castHosts([host('A'), host('B')], 'conversation', 'Warm, with dry humour.');
    expect(cast[0]!.role).not.toBe(cast[1]!.role);
    expect(cast[0]!.role).toMatch(/sceptical/);
    expect(cast.every((h) => h.role!.endsWith('Warm, with dry humour.'))).toBe(true);
  });

  it("keeps the listener's own descriptions", () => {
    const cast = castHosts([host('A', { role: 'A warm Christian mentor' }), host('B')], 'conversation');
    expect(cast[0]!.role).toBe('A warm Christian mentor');
  });

  it('marks an interview guest the listener did not describe as simulated', () => {
    const cast = castHosts([host('A'), host('B')], 'interview');
    expect(cast.map((h) => [h.kind, h.simulated ?? false])).toEqual([['host', false], ['guest', true]]);
    expect(cast[1]!.role).toMatch(/never claims to be a real person/);
  });

  it("treats a described expert as the guest, without calling them simulated", () => {
    const cast = castHosts([host('A', { role: 'An expert guest on sleep science' }), host('B', { role: 'Curious interviewer' })], 'interview');
    expect(cast.map((h) => h.kind)).toEqual(['guest', 'host']);
    expect(cast[0]!.simulated).toBeUndefined();
  });
});
