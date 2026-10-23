import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Embedder } from '@thinkmade/ai';

const MAX_BODY = 64 * 1024;
const MAX_INPUTS = 32;
const MAX_CHARS = 4_000;

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * OpenAI-style `POST /v1/embeddings` for the API, which can't run the embedding model on Vercel.
 * Bearer-token protected, small bodies only, and nothing else is served. Put HTTPS in front of it.
 */
export function createEmbedServer(embedder: Embedder, opts: { token: string; log?: (m: string) => void }): Server {
  if (opts.token.length < 32) throw new Error('EMBED_SERVER_TOKEN must be at least 32 characters.');
  return createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, model: embedder.name });
    if (req.method !== 'POST' || req.url !== '/v1/embeddings') return send(404, { error: 'not_found' });
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), opts.token)) return send(401, { error: 'unauthorized' });

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(413, { error: 'too_large' });
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', async () => {
      if (size > MAX_BODY) return;
      let body: { input?: unknown; input_type?: unknown };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: 'invalid_json' });
      }
      const input = typeof body.input === 'string' ? [body.input] : body.input;
      if (!Array.isArray(input) || !input.length || input.length > MAX_INPUTS || !input.every((t) => typeof t === 'string' && t.length <= MAX_CHARS)) {
        return send(400, { error: 'invalid_input' });
      }
      try {
        const vectors = await embedder.embed(input as string[], body.input_type === 'query' ? 'query' : 'document');
        send(200, { object: 'list', model: embedder.name, data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })) });
      } catch (err) {
        opts.log?.(`embedding failed: ${err instanceof Error ? err.message : String(err)}`);
        send(503, { error: 'embedding_failed' });
      }
    });
  });
}
