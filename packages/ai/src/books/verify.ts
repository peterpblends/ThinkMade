export interface BookClaim {
  title: string;
  author: string;
}

export type BookVerification =
  | {
      verified: true;
      via: 'openlibrary' | 'googlebooks';
      title: string;
      authors: string[];
      year?: number;
      isbn13?: string;
      openLibraryId?: string;
      googleBooksId?: string;
    }
  | { verified: false; reason: 'no_match' | 'lookup_failed' };

const UA = 'ThinkMade/0.1 (+https://thinkmade.zicaworld.com)';

/** Lowercase, drop subtitle and punctuation, collapse spaces. */
export function normaliseTitle(title: string): string {
  return title
    .split(':')[0]!
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function surname(name: string): string {
  const parts = name.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, ' ').trim().split(/\s+/);
  return parts.at(-1) ?? '';
}

function titlesMatch(claimed: string, found: string): boolean {
  const a = normaliseTitle(claimed);
  const b = normaliseTitle(found);
  if (!a || !b) return false;
  const strip = (s: string) => s.replace(/^(the|a|an) /, '');
  return strip(a) === strip(b);
}

function authorMatches(claimed: string, found: string[]): boolean {
  const s = surname(claimed);
  return s.length > 1 && found.some((f) => surname(f) === s);
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  return res.json();
}

/**
 * Confirms that a book with this title and author exists, using Open Library first and Google Books as
 * a fallback. A book counts as verified only when the normalised title and the author's surname both match.
 */
export async function verifyBook(claim: BookClaim, opts: { fetch?: typeof fetch } = {}): Promise<BookVerification> {
  const fetchFn = opts.fetch ?? fetch;
  let lookupsFailed = 0;
  try {
    const q = new URLSearchParams({ title: claim.title, author: claim.author, limit: '5', fields: 'key,title,author_name,first_publish_year,isbn' });
    const data = (await getJson(fetchFn, `https://openlibrary.org/search.json?${q}`)) as {
      docs?: Array<{ key: string; title: string; author_name?: string[]; first_publish_year?: number; isbn?: string[] }>;
    };
    const hit = data.docs?.find((d) => titlesMatch(claim.title, d.title) && authorMatches(claim.author, d.author_name ?? []));
    if (hit) {
      const isbn13 = hit.isbn?.find((i) => i.length === 13);
      return {
        verified: true,
        via: 'openlibrary',
        title: hit.title,
        authors: hit.author_name ?? [],
        openLibraryId: hit.key,
        ...(hit.first_publish_year ? { year: hit.first_publish_year } : {}),
        ...(isbn13 ? { isbn13 } : {}),
      };
    }
  } catch {
    lookupsFailed++;
  }
  try {
    const q = encodeURIComponent(`intitle:${claim.title} inauthor:${claim.author}`);
    const data = (await getJson(fetchFn, `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5`)) as {
      items?: Array<{ id: string; volumeInfo: { title: string; authors?: string[]; publishedDate?: string; industryIdentifiers?: Array<{ type: string; identifier: string }> } }>;
    };
    const hit = data.items?.find((i) => titlesMatch(claim.title, i.volumeInfo.title) && authorMatches(claim.author, i.volumeInfo.authors ?? []));
    if (hit) {
      const year = Number(hit.volumeInfo.publishedDate?.slice(0, 4));
      const isbn13 = hit.volumeInfo.industryIdentifiers?.find((x) => x.type === 'ISBN_13')?.identifier;
      return {
        verified: true,
        via: 'googlebooks',
        title: hit.volumeInfo.title,
        authors: hit.volumeInfo.authors ?? [],
        googleBooksId: hit.id,
        ...(year ? { year } : {}),
        ...(isbn13 ? { isbn13 } : {}),
      };
    }
  } catch {
    lookupsFailed++;
  }
  return { verified: false, reason: lookupsFailed === 2 ? 'lookup_failed' : 'no_match' };
}
