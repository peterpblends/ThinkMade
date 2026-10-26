/**
 * Example questions the Create box cycles through as its placeholder, to show what ThinkMade can help with.
 * Short enough to read on a phone; across leadership, personal growth, decisions, relationships,
 * problem-solving and everyday learning. The first is shown on arrival.
 */
export const CREATE_EXAMPLES = [
  'How can I recognize opportunities that others overlook?',
  'Why do smart people make bad decisions, and how can I avoid the same mistakes?',
  'How can I become a better leader without micromanaging people?',
  'How can I approach problems differently instead of repeating the same solutions?',
  'How can I have hard conversations without damaging the relationship?',
  'What can I learn from great thinkers about making difficult choices?',
  'How can I recognize when my assumptions are holding me back?',
  'How do I decide between two good options when both have real downsides?',
  'Why do I keep putting things off, and what actually helps?',
  'How can I understand people who see the world very differently from me?',
  'How can I learn something new faster and remember it longer?',
  "I'm having trouble motivating my team. Where do I start?",
] as const;

/** How long each example stays before the next one, in milliseconds. */
export const EXAMPLE_INTERVAL_MS = 4500;
