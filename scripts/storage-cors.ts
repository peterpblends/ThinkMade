/**
 * Lets browsers upload to and download from the object store (Backblaze B2, Cloudflare R2 or any
 * S3-compatible store). Production deploys do this automatically; run it yourself only for another bucket.
 * Reads S3_* and APP_URL from the environment or .env:
 *   npm run storage:cors
 * Extra allowed origins can follow as arguments.
 */
import { applyBrowserCors } from '../packages/ai/src/storage/s3';

const env = process.env;
const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} in .env first (the same values as in Vercel).`);
  process.exit(1);
}
const origins = [env.APP_URL ?? 'https://thinkmade.zicaworld.com', ...process.argv.slice(2)];
const allowed = await applyBrowserCors(
  { endpoint: env.S3_ENDPOINT!, region: env.S3_REGION, bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  origins,
);
console.info(`CORS set on ${env.S3_BUCKET}: ${allowed.join(', ')}`);
