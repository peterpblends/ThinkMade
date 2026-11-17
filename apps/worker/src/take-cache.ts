import type { ObjectStorage, TakeCache } from '@thinkmade/ai';

/** Takes from the natural-voice engine, kept in storage (16-bit PCM) so a retry doesn't pay for them again. */
export function storageTakeCache(storage: ObjectStorage): TakeCache {
  const path = (key: string) => `tts-takes/${key}.pcm`;
  return {
    async get(key) {
      if (!(await storage.head(path(key)))) return null;
      const obj = await storage.get(path(key));
      const chunks: Buffer[] = [];
      for await (const c of obj.stream) chunks.push(Buffer.from(c as Buffer));
      const b = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(b.length / 2));
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2) / 32768;
      return out.length ? out : null;
    },
    async put(key, samples) {
      const b = Buffer.alloc(samples.length * 2);
      for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
      await storage.put(path(key), b, 'application/octet-stream');
    },
  };
}
