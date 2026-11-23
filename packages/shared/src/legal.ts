/**
 * The current Terms of Service and Privacy Policy. Changing TERMS_VERSION asks every signed-in person to agree
 * to the new terms before they make podcasts or use coaching again; their agreement is recorded each time.
 */
export const TERMS_VERSION = '2026-11-23';
export const TERMS_EFFECTIVE_DATE = 'November 23, 2026';

/**
 * Who offers ThinkMade, as named in the terms. Fill in the registered company name, the state whose law
 * governs the terms and a contact address before relying on them.
 */
export const LEGAL = {
  /** The registered company that operates ThinkMade (e.g. "Kaspar Companies LLC"). */
  company: 'ThinkMade',
  /** The state (US) whose laws govern the terms and whose courts hear disputes. */
  governingState: 'Delaware',
  contactEmail: 'legal@thinkmade.app',
} as const;

/** The short notice shown beside the sign-up checkbox and on every podcast. */
export const AI_CONTENT_NOTICE =
  'Podcasts and coaching are created by AI. They can contain mistakes and are for general education only, not professional (medical, legal, financial or other) advice.';
