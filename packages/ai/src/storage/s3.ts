import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { assertSafeKey, type ObjectStorage } from './types';

export interface S3Config {
  endpoint: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Any S3-compatible store. Backblaze B2: endpoint https://s3.<region>.backblazeb2.com, region e.g.
 * "us-west-004". Cloudflare R2: endpoint https://<account>.r2.cloudflarestorage.com, region "auto".
 */
export function createS3Storage(cfg: S3Config): ObjectStorage {
  const clientPromise = (async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region ?? 'auto',
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
      // Newer AWS SDKs add CRC checksums to every upload by default, which some S3-compatible stores and
      // browser presigned uploads don't support. Only send them when an operation requires one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  })();
  return {
    kind: 's3',
    async put(key, body, contentType) {
      assertSafeKey(key);
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await (await clientPromise).send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async putFile(key, path, contentType) {
      assertSafeKey(key);
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { stat } = await import('node:fs/promises');
      const size = (await stat(path)).size;
      await (await clientPromise).send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: createReadStream(path), ContentType: contentType, ContentLength: size }),
      );
    },
    async head(key) {
      assertSafeKey(key);
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      try {
        const r = await (await clientPromise).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? 'application/octet-stream' };
      } catch {
        return null;
      }
    },
    async get(key, range) {
      assertSafeKey(key);
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const r = await (await clientPromise).send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
      );
      const size = Number(r.ContentLength ?? 0);
      const total = r.ContentRange ? Number(r.ContentRange.split('/')[1]) : size;
      return { stream: r.Body as Readable, size, totalSize: total, contentType: r.ContentType ?? 'application/octet-stream' };
    },
    async delete(key) {
      assertSafeKey(key);
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await clientPromise).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async presignGet(key, seconds) {
      assertSafeKey(key);
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      return getSignedUrl(await clientPromise, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: seconds });
    },
    async presignPut(key, contentType, size, seconds) {
      assertSafeKey(key);
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      return getSignedUrl(
        await clientPromise,
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType, ContentLength: size }),
        { expiresIn: seconds, signableHeaders: new Set(['content-type', 'content-length']) },
      );
    },
  };
}
