import { createReadStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertSafeKey, type ObjectStorage } from './types';

/** Files on local disk, for development and the single-machine worker. Metadata lives in a sidecar file. */
export function createLocalStorage(root: string): ObjectStorage {
  const base = resolve(root);
  mkdirSync(base, { recursive: true });
  const pathFor = (key: string) => {
    assertSafeKey(key);
    const p = resolve(join(base, key));
    if (!p.startsWith(base + '/')) throw new Error(`Invalid key: ${key}`);
    return p;
  };
  const metaFor = (p: string) => `${p}.meta.json`;
  return {
    kind: 'local',
    async put(key, body, contentType) {
      const p = pathFor(key);
      mkdirSync(dirname(p), { recursive: true });
      await fs.writeFile(p, body);
      await fs.writeFile(metaFor(p), JSON.stringify({ contentType }));
    },
    async putFile(key, path, contentType) {
      const p = pathFor(key);
      mkdirSync(dirname(p), { recursive: true });
      await fs.copyFile(path, p);
      await fs.writeFile(metaFor(p), JSON.stringify({ contentType }));
    },
    async head(key) {
      const p = pathFor(key);
      if (!existsSync(p)) return null;
      const stat = await fs.stat(p);
      const meta = JSON.parse(await fs.readFile(metaFor(p), 'utf8').catch(() => '{}')) as { contentType?: string };
      return { size: stat.size, contentType: meta.contentType ?? 'application/octet-stream' };
    },
    async get(key, range) {
      const head = await this.head(key);
      if (!head) throw new Error(`Object not found: ${key}`);
      const p = pathFor(key);
      if (range) {
        const end = Math.min(range.end, head.size - 1);
        return { stream: createReadStream(p, { start: range.start, end }), size: end - range.start + 1, totalSize: head.size, contentType: head.contentType };
      }
      return { stream: createReadStream(p), size: head.size, totalSize: head.size, contentType: head.contentType };
    },
    async delete(key) {
      const p = pathFor(key);
      await fs.rm(p, { force: true });
      await fs.rm(metaFor(p), { force: true });
    },
  };
}
