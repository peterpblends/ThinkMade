import type { Host } from './hosts.ts';
import type { ProductionSettings, ShowFormat } from './settings.ts';

/**
 * Picks a series' show format. One host is always storytelling. Otherwise the listener's request wins, then
 * the administrator's choice, then what suits the topic. Interviews need simulated guests to be allowed.
 */
export function chooseShowFormat(input: {
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  production: Pick<ProductionSettings, 'showFormat' | 'allowSimulatedGuests'>;
  requested?: ShowFormat | null | undefined;
  suggested?: ShowFormat | null | undefined;
}): ShowFormat {
  if (input.speakerFormat === 'single') return 'storytelling';
  const admin = input.production.showFormat === 'auto' ? null : input.production.showFormat;
  // With several hosts, "storytelling" means a conversation that leans on stories.
  const multi = (f: ShowFormat | null | undefined) => (f === 'storytelling' ? 'conversation' : f);
  const format = multi(input.requested) ?? multi(admin) ?? multi(input.suggested) ?? 'conversation';
  return format === 'interview' && !input.production.allowSimulatedGuests ? 'conversation' : format;
}

/** The format of one episode: single-host episodes of a mixed series are told as stories. */
export function episodeShowFormat(series: ShowFormat, hostCount: number): ShowFormat {
  return hostCount <= 1 ? 'storytelling' : series === 'storytelling' ? 'conversation' : series;
}

/** Complementary personalities for hosts the listener didn't describe, so they never sound alike. */
const PERSONAS: Record<ShowFormat, string[]> = {
  storytelling: [
    'A storyteller who is genuinely fascinated by people and ideas. Draws the listener in with stories, surprising discoveries and honest reflection, and keeps tying them back to the listener\'s own life.',
  ],
  conversation: [
    'Asks the questions a smart listener would. Curious and a little sceptical; pushes for concrete examples, says so when something doesn\'t add up, and sums things up in plain words.',
    'Has read deeply on the subject. Tells the stories, connects ideas across fields, and is honest about what isn\'t known.',
    'Brings the practitioner\'s view: how this actually plays out at work and at home, including when it goes wrong.',
    'Plays devil\'s advocate and looks for where the idea breaks down or is misused.',
  ],
  interview: [
    'A thoughtful interviewer. Listens closely, asks follow-ups that build on the last answer, asks for examples and pushes back politely.',
    'A simulated expert guest who knows the research and well-documented cases on this subject. Speaks with authority but never claims personal experiences, never claims to be a real person, and says what is uncertain.',
    'A second interviewer who asks the practical "so what do I do on Monday?" questions.',
    'A second simulated expert guest with a different view, so the two can disagree respectfully.',
  ],
};

/** Who is a guest in an interview: hosts described as guests or experts, else everyone after the first. */
function isGuest(host: Host, index: number): boolean {
  if (host.role) return /\b(guest|expert|interviewee|specialist)\b/i.test(host.role) && !/\binterview(er|s)\b/i.test(host.role);
  return index === 1 || index === 3;
}

/**
 * Gives each host a part in the show: the listener's own description when they gave one, otherwise a
 * complementary default. In interviews, guests are marked, and a guest the listener didn't describe is simulated.
 */
export function castHosts(hosts: Host[], format: ShowFormat, hostStyle = ''): Host[] {
  const personas = PERSONAS[format];
  const style = hostStyle.trim();
  return hosts.map((h, i) => {
    const described = !!h.role;
    const guest = format === 'interview' && isGuest(h, i);
    const role = described ? h.role! : (personas[i] ?? personas[personas.length - 1]!);
    return {
      ...h,
      role: style && !described ? `${role} ${style}` : role,
      ...(format === 'interview' ? { kind: guest ? ('guest' as const) : ('host' as const) } : {}),
      ...(guest && !described ? { simulated: true } : {}),
    };
  });
}

/** How many times an owner can make new artwork for a show (they can always go back to an earlier one). */
export const MAX_ARTWORK_REGENERATIONS = 3;

/** A show's artwork versions (seeds) and the one in use; the original artwork is drawn from the series id. */
export function artworkOf(series: { id: string; artwork?: { seeds: string[]; selected: number } | null }): { seeds: string[]; selected: number } {
  const seeds = series.artwork?.seeds?.length ? series.artwork.seeds : [series.id];
  const selected = Math.min(Math.max(0, series.artwork?.selected ?? 0), seeds.length - 1);
  return { seeds, selected };
}

/**
 * How a podcast is made, kept for all its episodes: a podcast has its own identity, and a listener's podcasts
 * differ from one another.
 */
export const SHOW_APPROACHES = ['storyteller', 'co_hosts', 'co_hosts_with_visitors', 'expert_guests', 'founder_guests'] as const;
export type ShowApproach = (typeof SHOW_APPROACHES)[number];

export const APPROACHES: Record<ShowApproach, { showFormat: ShowFormat; hosts: 1 | 2; guests: 'none' | 'some' | 'every'; label: string; describe: string }> = {
  storyteller: {
    showFormat: 'storytelling',
    hosts: 1,
    guests: 'none',
    label: 'A storyteller',
    describe: 'One host tells each episode as a story: real, well-documented cases, the best books on the subject, and what they mean for the listener.',
  },
  co_hosts: {
    showFormat: 'conversation',
    hosts: 2,
    guests: 'none',
    label: 'Two co-hosts',
    describe: 'Two co-hosts work through the best books and mental models on the topic, thinking out loud together, questioning each other and testing ideas against real situations.',
  },
  co_hosts_with_visitors: {
    showFormat: 'conversation',
    hosts: 2,
    guests: 'some',
    label: 'Co-hosts with visiting experts',
    describe: 'Two co-hosts think the topic through together, and now and then bring in a visiting expert who adds a fresh angle.',
  },
  expert_guests: {
    showFormat: 'interview',
    hosts: 1,
    guests: 'every',
    label: 'A host with expert guests',
    describe: 'One host brings in a different expert each episode (a researcher, practitioner or specialist suited to that episode) and draws out what they know with real questions and follow-ups.',
  },
  founder_guests: {
    showFormat: 'interview',
    hosts: 1,
    guests: 'every',
    label: 'A host with founders',
    describe: 'One host talks with a different founder or business builder each episode about how the idea played out as they built something: the decisions, mistakes and what they learned.',
  },
};

/**
 * Picks a podcast's approach. What the listener asked for and the administrator's settings narrow the choice;
 * among what's left, the approaches that suit the topic (best first) win, but not one the listener's last
 * podcasts already used, so their podcasts vary.
 */
export function chooseApproach(input: {
  speakerFormat: 'single' | 'two_hosts' | 'mixed';
  production: Pick<ProductionSettings, 'showFormat' | 'allowSimulatedGuests' | 'rotateGuests'> & { visitingGuests?: boolean };
  requested?: ShowFormat | null | undefined;
  /** The approach the listener asked for in their own words: used whenever it's allowed. */
  requestedApproach?: ShowApproach | null | undefined;
  /** Approaches that suit the topic, best first. */
  suitable?: ShowApproach[] | null | undefined;
  suggestedFormat?: ShowFormat | null | undefined;
  /** The listener's recent podcasts' approaches, newest first. */
  recent?: ShowApproach[];
  episodes: number;
  /** How many voices can be cast in the podcast's language. */
  voices: number;
}): ShowApproach {
  const admin = input.production.showFormat === 'auto' ? null : input.production.showFormat;
  const allowed = SHOW_APPROACHES.filter((a) => {
    const x = APPROACHES[a];
    if (input.speakerFormat === 'single' && (x.hosts !== 1 || x.guests !== 'none')) return false;
    // Two voices in every episode: two co-hosts, or a host and a guest.
    if (input.speakerFormat === 'two_hosts' && x.hosts + (x.guests === 'every' ? 1 : 0) !== 2) return false;
    if (x.hosts + (x.guests === 'none' ? 0 : 1) > input.voices) return false;
    if (x.guests !== 'none' && !input.production.allowSimulatedGuests) return false;
    if (x.guests === 'every' && !input.production.rotateGuests) return false;
    if (x.guests === 'some' && (input.production.visitingGuests === false || input.episodes < 2)) return false;
    for (const f of [input.requested, admin]) if (f && x.showFormat !== f && !(f === 'storytelling' && x.showFormat === 'conversation' && input.speakerFormat === 'two_hosts')) return false;
    return true;
  });
  if (input.requestedApproach && allowed.includes(input.requestedApproach)) return input.requestedApproach;
  if (!allowed.length) return input.speakerFormat === 'two_hosts' || (input.speakerFormat === 'mixed' && input.voices > 1) ? 'co_hosts' : 'storyteller';
  const fromFormat: ShowApproach[] = input.suggestedFormat === 'interview' ? ['expert_guests'] : input.suggestedFormat === 'storytelling' ? ['storyteller'] : input.suggestedFormat === 'conversation' ? ['co_hosts'] : [];
  // Best first: what suits the topic, then the rest (founders only when the topic suits them).
  const ranked = [...new Set([...(input.suitable ?? []), ...fromFormat, 'co_hosts', 'expert_guests', 'storyteller', 'co_hosts_with_visitors'] as ShowApproach[])].filter((a) => allowed.includes(a));
  const options = ranked.length ? ranked : allowed;
  const recent = input.recent ?? [];
  return options.find((a) => !recent.slice(0, 2).includes(a)) ?? options.find((a) => a !== recent[0]) ?? options[0]!;
}
