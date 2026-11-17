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

/** "A and B", "A & B", "A, B" -> ["A", "B"]. */
export function splitAuthors(claimed: string): string[] {
  return claimed
    .split(/\s*(?:,|&|\band\b|;|\bwith\b)\s*/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1);
}

/** True when any claimed author's surname matches any catalogue author's surname. */
function authorMatches(claimed: string, found: string[]): boolean {
  const claimedSurnames = splitAuthors(claimed).map(surname).filter((s) => s.length > 1);
  const foundSurnames = found.map(surname);
  return claimedSurnames.some((s) => foundSurnames.includes(s));
}

/** The part of a title before any subtitle. */
function mainTitle(title: string): string {
  return title.split(/[:—–]|\s-\s/)[0]!.trim() || title.trim();
}

/** Catalogue authors that match the claim, or the first catalogue author when none match by name. */
function displayAuthors(claimed: string, found: string[]): string[] {
  const wanted = splitAuthors(claimed).map(surname);
  const matched = [...new Set(found.filter((f) => wanted.includes(surname(f))))];
  return matched.length ? matched : found.slice(0, 1);
}

/** Keeps the catalogue's wording and punctuation, borrowing the claim's capitalisation word by word. */
function displayTitle(claimed: string, found: string): string {
  const casing = new Map(mainTitle(claimed).split(/\s+/).map((w) => [w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), w.replace(/[^\p{L}\p{N}]/gu, '')]));
  return mainTitle(found)
    .split(/(\s+)/)
    .map((tok) => {
      const bare = tok.replace(/[^\p{L}\p{N}]/gu, '');
      const better = casing.get(bare.toLowerCase());
      return better && bare ? tok.replace(bare, better) : tok;
    })
    .join('');
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
    // Search by main title and first author: catalogues often lack the subtitle, and models add co-authors.
    const q = new URLSearchParams({ title: mainTitle(claim.title), author: splitAuthors(claim.author)[0] ?? claim.author, limit: '10', fields: 'key,title,author_name,first_publish_year,isbn' });
    const data = (await getJson(fetchFn, `https://openlibrary.org/search.json?${q}`)) as {
      docs?: Array<{ key: string; title: string; author_name?: string[]; first_publish_year?: number; isbn?: string[] }>;
    };
    const hit = data.docs?.find((d) => titlesMatch(claim.title, d.title) && authorMatches(claim.author, d.author_name ?? []));
    if (hit) {
      const isbn13 = hit.isbn?.find((i) => i.length === 13);
      return {
        verified: true,
        via: 'openlibrary',
        title: displayTitle(claim.title, hit.title),
        authors: displayAuthors(claim.author, hit.author_name ?? []),
        openLibraryId: hit.key,
        ...(hit.first_publish_year ? { year: hit.first_publish_year } : {}),
        ...(isbn13 ? { isbn13 } : {}),
      };
    }
  } catch {
    lookupsFailed++;
  }
  try {
    const q = encodeURIComponent(`intitle:${mainTitle(claim.title)} inauthor:${surname(splitAuthors(claim.author)[0] ?? claim.author)}`);
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
        title: displayTitle(claim.title, hit.volumeInfo.title),
        authors: displayAuthors(claim.author, hit.volumeInfo.authors ?? []),
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

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What a verified book is actually about, from the catalogues and Wikipedia: the publisher's description
 * (Google Books or Open Library) and, when there is one, the book's own Wikipedia summary. Episodes are
 * written from this, so stories and ideas attributed to the book are the book's. Empty when nothing is found.
 */
export async function describeBook(
  book: { title: string; authors: string[]; googleBooksId?: string; openLibraryId?: string; isbn13?: string },
  opts: { fetch?: typeof fetch; maxChars?: number } = {},
): Promise<string> {
  const fetchFn = opts.fetch ?? fetch;
  const parts: string[] = [];
  const author = surname(book.authors[0] ?? '');
  // Google Books: by id, else by ISBN or title and author.
  try {
    const url = book.googleBooksId
      ? `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(book.googleBooksId)}`
      : `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(book.isbn13 ? `isbn:${book.isbn13}` : `intitle:${mainTitle(book.title)} inauthor:${author}`)}&maxResults=3`;
    const data = (await getJson(fetchFn, url)) as { volumeInfo?: { title?: string; description?: string }; items?: Array<{ volumeInfo: { title: string; description?: string } }> };
    const info = data.volumeInfo ?? data.items?.find((i) => titlesMatch(book.title, i.volumeInfo.title) && i.volumeInfo.description)?.volumeInfo;
    if (info?.description) parts.push(plain(info.description));
  } catch {
    /* the other sources may still answer */
  }
  // Open Library: the work's own description.
  if (!parts.length && book.openLibraryId?.startsWith('/works/')) {
    try {
      const work = (await getJson(fetchFn, `https://openlibrary.org${book.openLibraryId}.json`)) as { description?: string | { value?: string } };
      const d = typeof work.description === 'string' ? work.description : work.description?.value;
      if (d) parts.push(plain(d.replace(/\[[^\]]*\]\([^)]*\)/g, '').split(/-{3,}|\n\s*\n\s*\(/)[0]!));
    } catch {
      /* fine */
    }
  }
  // Wikipedia: only an article about this book (it names the author).
  try {
    const page = encodeURIComponent(mainTitle(book.title).replace(/\s+/g, '_'));
    const w = (await getJson(fetchFn, `https://en.wikipedia.org/api/rest_v1/page/summary/${page}`)) as { type?: string; extract?: string; description?: string };
    const text = `${w.description ?? ''} ${w.extract ?? ''}`;
    if (w.type === 'standard' && w.extract && author && text.toLowerCase().includes(author)) parts.push(plain(w.extract));
  } catch {
    /* fine */
  }
  const max = opts.maxChars ?? 1500;
  const about = parts.join(' ').trim();
  return about.length > max ? `${about.slice(0, about.lastIndexOf('.', max) + 1 || max)}` : about;
}
