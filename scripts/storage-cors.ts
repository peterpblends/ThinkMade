/**
 * Lets browsers upload to and download from the object store (Backblaze B2, Cloudflare R2 or any
 * S3-compatible store). Reads S3_* and APP_URL from the environment or .env; run it on your own machine:
 *   npm run storage:cors
 * Extra allowed origins can follow as arguments.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { storageRegion } from '../packages/ai/src/storage/s3';

const env = process.env;
const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} in .env first (the same values as in Vercel).`);
  process.exit(1);
}
const origins = [env.APP_URL ?? 'https://thinkmade.zicaworld.com', ...process.argv.slice(2)];
const client = new S3Client({
  endpoint: env.S3_ENDPOINT!.trim().replace(/^(?!https?:\/\/)/, 'https://'),
  region: storageRegion(env.S3_ENDPOINT!, env.S3_REGION),
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: true,
});
await client.send(
  new PutBucketCorsCommand({
    Bucket: env.S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['content-type', 'range'],
          ExposeHeaders: ['content-length', 'content-range', 'etag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
const check = await client.send(new GetBucketCorsCommand({ Bucket: env.S3_BUCKET }));
console.info(`CORS set on ${env.S3_BUCKET} for ${origins.join(', ')}: ${JSON.stringify(check.CORSRules?.[0]?.AllowedMethods)}`);
