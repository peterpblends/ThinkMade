import { createLocalStorage } from './local';
import { createS3Storage } from './s3';
import type { ObjectStorage } from './types';

/** S3/R2 when S3_BUCKET and credentials are set; otherwise local disk under STORAGE_DIR. */
export function createStorage(env: Record<string, string | undefined> = process.env): ObjectStorage {
  if (env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return createS3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'auto',
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (env.NODE_ENV === 'production' && !env.STORAGE_DIR) {
    throw new Error('Object storage is not configured: set S3_* variables (or STORAGE_DIR on a single-server deployment).');
  }
  return createLocalStorage(env.STORAGE_DIR ?? '.data/storage');
}
