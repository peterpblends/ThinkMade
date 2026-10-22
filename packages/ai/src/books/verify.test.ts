import { describe, expect, it } from 'vitest';
import { normaliseTitle, verifyBook } from './verify';

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
