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
