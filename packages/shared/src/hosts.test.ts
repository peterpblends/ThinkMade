import { describe, expect, it } from 'vitest';
import { chooseHosts } from './hosts';
import { DEFAULT_APP_SETTINGS, upgradeAppSettings, voiceInfo, VOICE_CATALOG } from './settings';

const pool = DEFAULT_APP_SETTINGS.voices.available;
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('chooseHosts', () => {
  it("uses the listener's hosts: names, ages, roles and a fitting distinct voice each", () => {
    const hosts = chooseHosts({
      count: 3,
      pool,
      requested: [
        { name: 'Emma', gender: 'female', age: 19, role: 'A fun, relatable Christian girl' },
        { name: 'Grace', gender: 'female', age: 22, role: 'Shares practical wisdom' },
        { name: 'Sarah', gender: 'female', age: 35, role: 'A warm mentor' },
      ],
    });
    expect(hosts.map((h) => [h.id, h.name, h.age])).toEqual([['A', 'Emma', 19], ['B', 'Grace', 22], ['C', 'Sarah', 35]]);
    expect(hosts[2]!.role).toBe('A warm mentor');
    expect(new Set(hosts.map((h) => h.voice)).size).toBe(3);
    for (const h of hosts) expect(voiceInfo(h.voice)?.gender).toBe('female');
  });

  it('gives unnamed hosts the name of their voice, and contrasting voices for two hosts', () => {
    const hosts = chooseHosts({ count: 2, pool, random: () => 0 });
    expect(hosts.map((h) => h.name)).toEqual(hosts.map((h) => voiceInfo(h.voice)!.name));
    expect(voiceInfo(hosts[0]!.voice)!.gender).not.toBe(voiceInfo(hosts[1]!.voice)!.gender);
  });

  it('varies voices between series by avoiding recently heard ones', () => {
    const first = chooseHosts({ count: 2, pool, random: () => 0 });
    const second = chooseHosts({ count: 2, pool, random: () => 0, recent: first.map((h) => h.voice) });
    expect(second.map((h) => h.voice)).not.toContain(first[0]!.voice);
    expect(second.map((h) => h.voice)).not.toContain(first[1]!.voice);
  });

  it('picks from the whole range of voices', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(chooseHosts({ count: 1, pool, random: seq(i / 400) })[0]!.voice);
    expect(seen.size).toBeGreaterThan(20);
  });

  it("uses the voices the listener picked, in host order", () => {
    const hosts = chooseHosts({ count: 2, pool, chosenVoices: ['bm_george', 'phonon:freya'] });
    expect(hosts.map((h) => [h.voice, h.name])).toEqual([['bm_george', 'George'], ['phonon:freya', 'Freya']]);
  });

  it('ignores a picked voice that is not allowed', () => {
    const hosts = chooseHosts({ count: 1, pool: ['phonon:zoey'], chosenVoices: ['bm_george'] });
    expect(hosts[0]!.voice).toBe('phonon:zoey');
  });

  it("never gives an unnamed host another host's name", () => {
    // Only one voice is called Emma; the listener's Emma keeps her name and the other host gets a different one.
    const hosts = chooseHosts({ count: 2, pool: ['bf_emma', 'bf_alice'], requested: [{ name: 'Emma' }, {}], random: () => 0 });
    expect(hosts.map((h) => h.name)).toEqual(['Emma', 'Alice']);
  });
});

describe('upgradeAppSettings', () => {
  it('adds the new voices to a list that still matches the old default', () => {
    const legacy = [...DEFAULT_APP_SETTINGS.voices.available.filter((v) => v.startsWith('phonon:')), 'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];
    const up = upgradeAppSettings({ ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: legacy } });
    expect(up.voices.available).toHaveLength(VOICE_CATALOG.length);
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it("leaves an administrator's own list alone", () => {
    const custom = { ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: ['phonon:zoey', 'am_adam'] } };
    expect(upgradeAppSettings(custom)).toBe(custom);
  });
});
