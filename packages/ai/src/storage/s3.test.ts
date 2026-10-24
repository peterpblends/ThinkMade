import { describe, expect, it } from 'vitest';
import { createS3Storage, storageRegion } from './s3';

describe('storageRegion', () => {
  it('takes the region from a Backblaze B2 endpoint when none (or R2 auto) is set', () => {
    expect(storageRegion('https://s3.us-west-004.backblazeb2.com', 'auto')).toBe('us-west-004');
    expect(storageRegion('s3.eu-central-003.backblazeb2.com')).toBe('eu-central-003');
    expect(storageRegion('https://s3.us-west-004.backblazeb2.com', 'us-east-005')).toBe('us-east-005');
    expect(storageRegion('https://abc.r2.cloudflarestorage.com', 'auto')).toBe('auto');
  });

  it('signs B2 URLs for the endpoint region, even when the endpoint has no https://', async () => {
    const s = createS3Storage({ endpoint: 's3.us-west-004.backblazeb2.com', bucket: 'tm', accessKeyId: 'AKID', secretAccessKey: 'x', region: 'auto' });
    const url = new URL(await s.presignGet!('a.mp3', 60));
    expect(url.host).toBe('s3.us-west-004.backblazeb2.com');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/us-west-004/s3/');
    expect(url.toString()).not.toContain('checksum');
  });
});
