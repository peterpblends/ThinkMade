import { describe, expect, it } from 'vitest';
import { chooseHosts } from './hosts';
import { castableByDefault, DEFAULT_APP_SETTINGS, KOKORO_VOICE_INFO, PHONON_VOICES, upgradeAppSettings, usableVoices, voiceInfo, VOICE_CATALOG } from './settings';

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

  it('gives every host a female or male voice when the listener asks, unless a host is described otherwise', () => {
    for (const gender of ['female', 'male'] as const) {
      for (let i = 0; i < 10; i++) {
        const hosts = chooseHosts({ count: 3, pool, gender });
        expect(hosts.map((h) => voiceInfo(h.voice)!.gender)).toEqual([gender, gender, gender]);
        expect(new Set(hosts.map((h) => h.voice)).size).toBe(3);
      }
    }
    const described = chooseHosts({ count: 2, pool, gender: 'female', requested: [{ name: 'Tom', gender: 'male' }, { name: 'Ann' }] });
    expect(described.map((h) => voiceInfo(h.voice)!.gender)).toEqual(['male', 'female']);
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

describe('casting voices for a professional show', () => {
  const many = (input: Partial<Parameters<typeof chooseHosts>[0]>, n = 300) =>
    Array.from({ length: n }, (_, i) => chooseHosts({ count: 1, pool, random: seq(i / n), ...input })[0]!.voice);

  it('never casts poorly graded or whispered voices automatically', () => {
    const cast = new Set(many({}));
    for (const bad of ['am_adam', 'af_jessica', 'bm_daniel', 'af_nicole']) expect(cast.has(bad), bad).toBe(false);
    expect([...cast].every((v) => castableByDefault(voiceInfo(v)!))).toBe(true);
  });

  it('lets an administrator switch a voice in or out of casting', () => {
    const only = Object.fromEntries(pool.filter((v) => v !== 'am_adam').map((v) => [v, { autoCast: false }]));
    expect(new Set(many({ profiles: { ...only, am_adam: { autoCast: true } } }, 20))).toEqual(new Set(['am_adam']));
  });

  it('uses the age an administrator tagged to suit the host', () => {
    const profiles = { 'phonon:zoey': { age: 'young' as const }, 'phonon:delia': { age: 'mature' as const } };
    const young = many({ profiles, requested: [{ name: 'Emma', gender: 'female', age: 19 }] }, 50);
    const mentor = many({ profiles, requested: [{ name: 'Sarah', gender: 'female', age: 58 }] }, 50);
    expect(new Set(young)).toEqual(new Set(['phonon:zoey']));
    expect(new Set(mentor)).toEqual(new Set(['phonon:delia']));
  });

  it('gives a British audience British voices', () => {
    expect(many({ preferAccent: 'UK' }).every((v) => voiceInfo(v)!.accent === 'UK')).toBe(true);
  });

  it('keeps clear of voices and names already in the show', () => {
    const main = chooseHosts({ count: 1, pool, random: () => 0 })[0]!;
    const guests = many({ exclude: [main.voice], takenNames: [main.name], ids: ['B'] }, 50);
    expect(guests).not.toContain(main.voice);
    expect(guests.map((v) => voiceInfo(v)!.name)).not.toContain(main.name);
  });
});

describe('accent voices', () => {
  it('are American English with another heritage, not cast unless asked for', () => {
    expect(voiceInfo('phonon:regina')).toMatchObject({ engine: 'Phonon', accent: 'US', gender: 'female', heritage: 'latino' });
    expect(voiceInfo('hm_omega')).toMatchObject({ engine: 'Kokoro', heritage: 'south-asian', gender: 'male' });
    expect(castableByDefault(voiceInfo('jf_alpha')!)).toBe(false);
    for (let i = 0; i < 20; i++) {
      for (const h of chooseHosts({ count: 2, pool })) expect(voiceInfo(h.voice)!.heritage).toBeUndefined();
    }
  });

  it('casts a host the listener described with a heritage from those voices', () => {
    for (let i = 0; i < 10; i++) {
      const [a, b] = chooseHosts({ count: 2, pool, requested: [{ name: 'Sofia', gender: 'female', heritage: 'latino' }, { name: 'Dev', gender: 'male', heritage: 'south-asian' }] });
      expect(voiceInfo(a!.voice)).toMatchObject({ heritage: 'latino', gender: 'female' });
      expect(voiceInfo(b!.voice)).toMatchObject({ heritage: 'south-asian', gender: 'male' });
    }
  });

  it('are left out of usable voices while the feature is off', () => {
    const on = usableVoices(DEFAULT_APP_SETTINGS);
    const off = usableVoices({ ...DEFAULT_APP_SETTINGS, features: { ...DEFAULT_APP_SETTINGS.features, accentVoices: false } });
    expect(on).toContain('phonon:ximena');
    expect(off).not.toContain('phonon:ximena');
    expect(off).not.toContain('hf_beta');
    expect(off).toContain('phonon:zoey');
  });
});

describe('upgradeAppSettings', () => {
  it('adds the new voices to a list that still matches the old default', () => {
    const legacy = [...PHONON_VOICES.map((v) => `phonon:${v.key}`), 'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];
    const up = upgradeAppSettings({ ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: legacy } });
    expect(up.voices.available).toHaveLength(VOICE_CATALOG.length);
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it('adds the accent voices to a list that still matches the catalog before them', () => {
    const before = [...PHONON_VOICES.map((v) => `phonon:${v.key}`), ...KOKORO_VOICE_INFO.map((v) => v.id)];
    const up = upgradeAppSettings({ ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: before } });
    expect(up.voices.available).toEqual(expect.arrayContaining(['phonon:regina', 'phonon:lalo', 'hf_alpha', 'jm_kumo', 'zf_xiaoxiao', 'em_alex']));
  });

  it("leaves an administrator's own list alone", () => {
    const custom = { ...DEFAULT_APP_SETTINGS, voices: { ...DEFAULT_APP_SETTINGS.voices, available: ['phonon:zoey', 'am_adam'] } };
    expect(upgradeAppSettings(custom)).toBe(custom);
  });
});
