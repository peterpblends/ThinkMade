import type { Readable } from 'node:stream';

export interface StoredObject {
  stream: Readable;
  size: number;
  /** Total object size (differs from `size` for range reads). */
  totalSize: number;
  contentType: string;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface ObjectStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  putFile(key: string, path: string, contentType: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<StoredObject>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Short-lived direct download URL, when the backend supports it. */
  presignGet?(key: string, seconds: number): Promise<string>;
  /** Short-lived URL a browser can PUT a file to directly (bypasses the API's request size limit). */
  presignPut?(key: string, contentType: string, size: number, seconds: number): Promise<string>;
}

export function assertSafeKey(key: string) {
  if (!key || key.startsWith('/') || key.split('/').some((p) => p === '..' || p === '') || /[\\\0]/.test(key)) {
    throw new Error(`Invalid key: ${key}`);
  }
}
