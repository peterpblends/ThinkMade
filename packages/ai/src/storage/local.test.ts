import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, describe, expect, it } from 'vitest';
import { createLocalStorage } from './local';

const dir = mkdtempSync(join(tmpdir(), 'tm-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('local storage', () => {
  const store = createLocalStorage(dir);

  it('stores and reads an object with its content type', async () => {
    await store.put('a/b.txt', Buffer.from('hello world'), 'text/plain');
    const obj = await store.get('a/b.txt');
    expect(obj.size).toBe(11);
    expect(obj.contentType).toBe('text/plain');
    expect(await text(obj.stream)).toBe('hello world');
  });

  it('reads a byte range', async () => {
    const obj = await store.get('a/b.txt', { start: 6, end: 10 });
    expect(await text(obj.stream)).toBe('world');
  });

  it('rejects keys that escape the storage folder', async () => {
    await expect(store.put('../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid key/i);
  });

  it('deletes objects and reports missing ones', async () => {
    await store.delete('a/b.txt');
    await expect(store.get('a/b.txt')).rejects.toThrow(/not found/i);
  });
});
