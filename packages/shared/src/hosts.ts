import { languageInfo } from './languages.ts';
import { castableByDefault, voiceInfo, VOICE_CATALOG, type Heritage, type VoiceInfo, type VoiceProfile } from './settings.ts';

export const HOST_IDS = ['A', 'B', 'C', 'D'] as const;
export type HostId = (typeof HOST_IDS)[number];

/** A podcast host: who speaks a script's lines, and with which voice. */
export interface Host {
  id: HostId;
  name: string;
  voice: string;
  age?: number;
  /** The persona the listener described, e.g. "a warm mentor who gives biblical guidance". */
  role?: string;
  /** In an interview: the interviewer(s) or the guest(s). */
  kind?: 'host' | 'guest';
  /** A guest voiced from research rather than a real person; always introduced as simulated. */
  simulated?: boolean;
}

/** A host as the listener described them; any part may be missing. */
export interface RequestedHost {
  name?: string | null | undefined;
  gender?: 'female' | 'male' | null | undefined;
  accent?: 'US' | 'UK' | null | undefined;
  /** An accent from another heritage the listener asked for (e.g. a Latina co-host). */
  heritage?: Heritage | null | undefined;
  age?: number | null | undefined;
  role?: string | null | undefined;
}

export interface ChooseHostsInput {
  /** How many hosts the series has (the listener's own hosts, when they named any, decide this). */
  count: number;
  requested?: RequestedHost[];
  /** Voices the listener picked, in host order. */
  chosenVoices?: string[];
  /** Voices allowed for this series. */
  pool: string[];
  /** Female or male voices for hosts whose description doesn't say. */
  gender?: 'female' | 'male' | null;
  /** The podcast's language: only voices that speak it are cast (English when left out). */
  language?: string;
  /** What administrators noted about voices: age band and whether to cast automatically. */
  profiles?: Record<string, VoiceProfile>;
  /** The accent the show should use unless a host says otherwise (e.g. British for a UK audience). */
  preferAccent?: 'US' | 'UK' | null;
  /** Voices from the listener's recent series, used last so each series sounds different. */
  recent?: string[];
  /** Voices already taken (e.g. the series' main host, or earlier episodes' guests). */
  exclude?: string[];
  /** Names already taken by other people in the show. */
  takenNames?: string[];
  /** Ids to give the hosts, in order (defaults to A, B, C, D). */
  ids?: HostId[];
  random?: () => number;
}

/** The age band a host's age falls in, for matching against voices an administrator has tagged. */
export function ageBand(age: number | null | undefined): VoiceProfile['age'] | undefined {
  if (!age) return undefined;
  return age < 26 ? 'young' : age < 50 ? 'adult' : 'mature';
}

/**
 * A small quality nudge. Poor voices are already out of automatic casting; among the rest, better-graded voices
 * win close calls without crowding out the variety that makes each series sound different. Phonon publishes no
 * grades and sits with the good Kokoro voices.
 */
function qualityScore(v: VoiceInfo): number {
  if (!v.grade) return 1.5;
  return ({ A: 1.8, 'A-': 1.7, 'B-': 1.4, 'C+': 1.1, C: 0.9, 'C-': 0.7 } as Record<string, number>)[v.grade] ?? 0;
}

/**
 * Casts a distinct voice and name for each host, as a producer would. Voices the listener picked come first.
 * Otherwise, from voices good enough to cast automatically (or that an administrator switched on), every
 * candidate must fit the host's gender and not be taken; among those, the best scores on: the age band an
 * administrator tagged, the show's accent, voice quality, and not having been heard in the listener's recent
 * series. Ties are broken at random so shows sound different. Hosts take the listener's names, or a name
 * that suits their voice.
 */
export function chooseHosts(input: ChooseHostsInput): Host[] {
  const random = input.random ?? Math.random;
  const profiles = input.profiles ?? {};
  const language = languageInfo(input.language).code;
  const pool = input.pool.map(voiceInfo).filter((v): v is VoiceInfo => !!v && v.speaks.includes(language));
  const all = pool.length ? pool : VOICE_CATALOG.filter((v) => v.speaks.includes(language));
  // In another language every voice that speaks it is a native voice, so all of them may be cast.
  const castable = language === 'en' ? all.filter((v) => profiles[v.id]?.autoCast ?? castableByDefault(v)) : all;
  const usable = castable.length ? castable : all;
  const recent = new Set(input.recent ?? []);
  const ids = input.ids ?? [...HOST_IDS];
  const count = Math.min(ids.length, Math.max(1, input.count));
  const hosts: Host[] = [];
  const used = new Set<string>(input.exclude ?? []);
  const names = new Set<string>(
    [...(input.takenNames ?? []), ...(input.requested ?? []).map((r) => r?.name ?? '')].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  for (let i = 0; i < count; i++) {
    const requested = input.requested?.[i] ?? {};
    const want = { ...requested, gender: requested.gender ?? input.gender ?? null };
    const picked = input.chosenVoices?.[i];
    let voice = picked && all.some((v) => v.id === picked) && !used.has(picked) ? voiceInfo(picked)! : undefined;
    if (!voice) {
      const accent = want.accent ?? input.preferAccent ?? (hosts[0] ? voiceInfo(hosts[0].voice)?.accent : undefined);
      // Without a stated gender, a two-host show alternates voices for contrast.
      const contrast = !input.requested?.length && !input.gender && hosts.length ? (voiceInfo(hosts.at(-1)!.voice)?.gender === 'female' ? 'male' : 'female') : undefined;
      const band = ageBand(want.age);
      // An unnamed host is called by the voice's name, so it must not clash with another person's name.
      const nameFree = (v: VoiceInfo) => !!want.name?.trim() || !names.has(v.name.toLowerCase());
      const score = (v: VoiceInfo) =>
        (band && profiles[v.id]?.age ? (profiles[v.id]!.age === band ? 3 : -2) : 0) +
        (accent && v.accent === accent ? 2 : 0) +
        (contrast && v.gender === contrast ? 2 : 0) +
        (recent.has(v.id) ? 0 : 2) +
        qualityScore(v);
      // Asked for by the listener, so any allowed voice of that heritage will do (they aren't cast otherwise).
      const heritageMatch = want.heritage ? all.filter((v) => v.heritage === want.heritage && !used.has(v.id) && (!want.gender || v.gender === want.gender)) : [];
      const candidates = [
        heritageMatch,
        usable.filter((v) => !used.has(v.id) && (!want.gender || v.gender === want.gender) && nameFree(v)),
        usable.filter((v) => !used.has(v.id) && (!want.gender || v.gender === want.gender)),
        all.filter((v) => !used.has(v.id)),
        all,
      ].find((c) => c.length)!;
      const best = Math.max(...candidates.map(score));
      const top = candidates.filter((v) => score(v) >= best - 0.6);
      voice = top[Math.floor(random() * top.length)]!;
    }
    used.add(voice.id);
    const name = want.name?.trim() || voice.name;
    names.add(name.toLowerCase());
    hosts.push({
      id: ids[i]!,
      name,
      voice: voice.id,
      ...(want.age ? { age: want.age } : {}),
      ...(want.role?.trim() ? { role: want.role.trim() } : {}),
    });
  }
  return hosts;
}
