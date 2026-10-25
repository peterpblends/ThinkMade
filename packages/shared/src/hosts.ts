import { voiceInfo, VOICE_CATALOG, type VoiceInfo } from './settings.ts';

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
}

/** A host as the listener described them; any part may be missing. */
export interface RequestedHost {
  name?: string | null | undefined;
  gender?: 'female' | 'male' | null | undefined;
  accent?: 'US' | 'UK' | null | undefined;
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
  /** Voices from the listener's recent series, used last so each series sounds different. */
  recent?: string[];
  random?: () => number;
}

/**
 * Picks a distinct voice and name for each host. Voices the listener picked come first; otherwise a voice
 * matching the described gender and accent, preferring ones the listener hasn't heard recently and Phonon
 * (the higher-quality engine). Hosts take the listener's names, or else a name that suits their voice.
 */
export function chooseHosts(input: ChooseHostsInput): Host[] {
  const random = input.random ?? Math.random;
  const pool = input.pool.map(voiceInfo).filter((v): v is VoiceInfo => !!v);
  const usable = pool.length ? pool : [...VOICE_CATALOG];
  const recent = new Set(input.recent ?? []);
  const count = Math.min(HOST_IDS.length, Math.max(1, input.count));
  const hosts: Host[] = [];
  const used = new Set<string>();
  const names = new Set<string>((input.requested ?? []).map((r) => r?.name?.trim().toLowerCase()).filter((n): n is string => !!n));

  for (let i = 0; i < count; i++) {
    const want = input.requested?.[i] ?? {};
    const picked = input.chosenVoices?.[i];
    let voice = picked && usable.some((v) => v.id === picked) && !used.has(picked) ? voiceInfo(picked)! : undefined;
    if (!voice) {
      const free = usable.filter((v) => !used.has(v.id));
      const firstAccent = hosts[0] ? voiceInfo(hosts[0].voice)?.accent : undefined;
      // Without a stated gender, a two-host show alternates voices for contrast.
      const gender = want.gender ?? (input.requested?.length ? undefined : hosts.length ? (voiceInfo(hosts.at(-1)!.voice)?.gender === 'female' ? 'male' : 'female') : undefined);
      const fits = (v: VoiceInfo) => (!gender || v.gender === gender) && (!(want.accent ?? firstAccent) || v.accent === (want.accent ?? firstAccent));
      // An unnamed host is called by the voice's name, so it must not clash with another host's name.
      const nameFree = (v: VoiceInfo) => !!want.name?.trim() || !names.has(v.name.toLowerCase());
      const tiers = [
        free.filter((v) => fits(v) && nameFree(v) && !recent.has(v.id) && v.engine === 'Phonon'),
        free.filter((v) => fits(v) && nameFree(v) && !recent.has(v.id)),
        free.filter((v) => fits(v) && nameFree(v)),
        free.filter((v) => (!want.gender || v.gender === want.gender) && nameFree(v)),
        free,
        usable,
      ];
      const tier = tiers.find((t) => t.length)!;
      voice = tier[Math.floor(random() * tier.length)]!;
    }
    used.add(voice.id);
    const name = want.name?.trim() || voice.name;
    names.add(name.toLowerCase());
    hosts.push({
      id: HOST_IDS[i]!,
      name,
      voice: voice.id,
      ...(want.age ? { age: want.age } : {}),
      ...(want.role?.trim() ? { role: want.role.trim() } : {}),
    });
  }
  return hosts;
}
