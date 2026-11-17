import { describe, expect, it } from 'vitest';
import { describeBook, normaliseTitle, verifyBook } from './verify';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('verifyBook', () => {
  it('verifies through Open Library when title and author match', async () => {
    const fetchFn = (async (url: string) => {
      expect(url).toContain('openlibrary.org/search.json');
      return json({ docs: [{ key: '/works/OL1W', title: 'Thinking, Fast and Slow', author_name: ['Daniel Kahneman'], first_publish_year: 2011, isbn: ['9780374533557'] }] });
    }) as typeof fetch;
    const result = await verifyBook({ title: 'Thinking Fast and Slow', author: 'Daniel Kahneman' }, { fetch: fetchFn });
    expect(result).toMatchObject({ verified: true, via: 'openlibrary', openLibraryId: '/works/OL1W', title: 'Thinking, Fast and Slow', authors: ['Daniel Kahneman'], year: 2011 });
  });

  it('falls back to Google Books when Open Library has no match', async () => {
    const fetchFn = (async (url: string) =>
      url.includes('openlibrary')
        ? json({ docs: [] })
        : json({ items: [{ id: 'g1', volumeInfo: { title: 'The Goal', authors: ['Eliyahu M. Goldratt', 'Jeff Cox'], publishedDate: '1984-01-01' } }] })) as typeof fetch;
    const result = await verifyBook({ title: 'The Goal', author: 'Eliyahu Goldratt' }, { fetch: fetchFn });
    expect(result).toMatchObject({ verified: true, via: 'googlebooks', googleBooksId: 'g1', year: 1984 });
  });

  it('rejects a book whose author does not match', async () => {
    const fetchFn = (async () => json({ docs: [{ key: '/works/X', title: 'The Goal', author_name: ['Someone Else'] }], items: [] })) as typeof fetch;
    expect(await verifyBook({ title: 'The Goal', author: 'Eliyahu Goldratt' }, { fetch: fetchFn })).toEqual({ verified: false, reason: 'no_match' });
  });

  it('reports a lookup failure rather than claiming the book is fake', async () => {
    const fetchFn = (async () => new Response('down', { status: 503 })) as typeof fetch;
    expect(await verifyBook({ title: 'X', author: 'Y' }, { fetch: fetchFn })).toEqual({ verified: false, reason: 'lookup_failed' });
  });

  it('normalises titles for comparison', () => {
    expect(normaliseTitle('Thinking, Fast and Slow: A Study')).toBe('thinking fast and slow');
    expect(normaliseTitle('The 7 Habits of Highly Effective People')).toBe('the 7 habits of highly effective people');
  });
});

describe('verifyBook with real-world model output', () => {
  it('searches by main title and first author when the claim has a subtitle and co-authors', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return json({ docs: [{ key: '/works/OL2463051W', title: 'The goal', author_name: ['Eliyahu M. Goldratt', 'Jeff Cox'], first_publish_year: 1984 }] });
    }) as typeof fetch;
    const result = await verifyBook({ title: 'The Goal: A Process of Ongoing Improvement', author: 'Eliyahu M. Goldratt and Jeff Cox' }, { fetch: fetchFn });
    expect(result).toMatchObject({ verified: true, openLibraryId: '/works/OL2463051W', authors: ['Eliyahu M. Goldratt', 'Jeff Cox'] });
    const q = new URL(urls[0]!).searchParams;
    expect(q.get('title')).toBe('The Goal');
    expect(q.get('author')).toBe('Eliyahu M. Goldratt');
  });

  it('accepts a match on any one of several claimed authors', async () => {
    const fetchFn = (async () => json({ docs: [{ key: '/works/OL5929411W', title: 'The 80/20 Principle', author_name: ['Richard Koch'] }] })) as typeof fetch;
    const result = await verifyBook({ title: 'The 80/20 Principle: The Secret to Success', author: 'Stephen G. Webb & Richard Koch' }, { fetch: fetchFn });
    expect(result).toMatchObject({ verified: true, authors: ['Richard Koch'] });
  });

  it('still rejects a title that does not exist even if the author is real', async () => {
    const fetchFn = (async () => json({ docs: [{ key: '/works/OL5929411W', title: 'The 80/20 Principle', author_name: ['Richard Koch'] }], items: [] })) as typeof fetch;
    expect(await verifyBook({ title: 'The Pareto Principle: The 80/20 Solution', author: 'Richard Koch' }, { fetch: fetchFn })).toEqual({ verified: false, reason: 'no_match' });
  });
});

describe('verifyBook display values', () => {
  it('keeps only the authors that match the claim and tidy capitalisation', async () => {
    const fetchFn = (async () => json({ docs: [{ key: '/works/OL1W', title: 'The goal', author_name: ['Eliyahu M. Goldratt', 'Jeff Cox', 'Ensemble cast'] }] })) as typeof fetch;
    const r = await verifyBook({ title: 'The Goal: A Process of Ongoing Improvement', author: 'Eliyahu M. Goldratt' }, { fetch: fetchFn });
    expect(r).toMatchObject({ verified: true, title: 'The Goal', authors: ['Eliyahu M. Goldratt'] });
  });
});

describe('describeBook', () => {
  const route = (map: Record<string, unknown>) =>
    (async (url: string) => {
      const hit = Object.entries(map).find(([k]) => url.includes(k));
      return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

  it('combines the publisher description and the book’s own Wikipedia summary', async () => {
    const about = await describeBook(
      { title: 'Shoe Dog', authors: ['Phil Knight'], googleBooksId: 'abc' },
      {
        fetch: route({
          'volumes/abc': { volumeInfo: { title: 'Shoe Dog', description: '<p>In this candid memoir, Nike founder <b>Phil Knight</b> shares the story.</p>' } },
          'wikipedia.org': { type: 'standard', description: '2016 memoir by Phil Knight', extract: 'Shoe Dog is a memoir by Nike co-founder Phil Knight.' },
        }),
      },
    );
    expect(about).toBe('In this candid memoir, Nike founder Phil Knight shares the story. Shoe Dog is a memoir by Nike co-founder Phil Knight.');
  });

  it('ignores a Wikipedia article about something else, and falls back to Open Library', async () => {
    const about = await describeBook(
      { title: 'Grit', authors: ['Angela Duckworth'], openLibraryId: '/works/OL1W' },
      {
        fetch: route({
          'openlibrary.org/works/OL1W.json': { description: { value: 'Duckworth shows that passion and persistence matter more than talent.' } },
          'wikipedia.org': { type: 'standard', description: 'Personality trait', extract: 'Grit is a personality trait.' },
        }),
      },
    );
    expect(about).toBe('Duckworth shows that passion and persistence matter more than talent.');
  });
});
