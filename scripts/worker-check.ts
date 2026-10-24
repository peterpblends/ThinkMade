/**
 * Tests the worker's settings against the real services and reports OK or what's wrong.
 * Never prints a secret. Run: npm run worker:check
 */
import { createDb } from '@thinkmade/db';
import { createS3Storage } from '../packages/ai/src/storage/s3';

const env = process.env;
let failures = 0;
const report = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.info(`${ok ? 'OK  ' : 'FIX '} ${name.padEnd(12)} ${detail}`);
};
const shape = (v: string | undefined) => (v ? `${v.length} characters` : 'missing');

async function check(name: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [ok, detail] = await fn();
    report(name, ok, detail);
  } catch (err) {
    report(name, false, err instanceof Error ? err.message.split('\n')[0]!.slice(0, 160) : String(err));
  }
}

await check('Database', async () => {
  if (!env.DATABASE_URL) return [false, 'DATABASE_URL is missing'];
  const h = await createDb({ databaseUrl: env.DATABASE_URL });
  try {
    await h.db.execute('select 1' as never);
    return [true, 'connected'];
  } finally {
    await h.close();
  }
});

await check('Groq', async () => {
  const key = env.GROQ_API_KEY;
  if (!key) return [false, 'GROQ_API_KEY is missing'];
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${key}` } });
  if (res.ok) return [true, 'key accepted'];
  const hint = key.length !== 56 ? ` Groq keys are 56 characters; this one is ${shape(key)}, so it was probably pasted twice or with extra text.` : '';
  return [false, `key rejected (${res.status}).${hint}`];
});

await check('OpenRouter', async () => {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return [false, 'OPENROUTER_API_KEY is missing (needed only for photos and videos)'];
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } });
  return res.ok ? [true, 'key accepted'] : [false, `key rejected (${res.status}); ${shape(key)}`];
});

await check('Backblaze', async () => {
  if (!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) return [false, 'an S3_ setting is missing'];
  const s = createS3Storage({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY });
  const key = `health/worker-check-${Date.now()}.txt`;
  await s.put(key, Buffer.from('ok'), 'text/plain');
  await s.delete(key);
  return [true, 'can write and delete in the bucket'];
});

console.info(failures ? `\n${failures} setting(s) need fixing: run npm run worker:setup, then npm run worker:mac -- install.` : '\nAll good. Restart the worker to use these settings: npm run worker:mac -- install');
process.exitCode = failures ? 1 : 0;
