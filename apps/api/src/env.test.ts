import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies local defaults', () => {
    const env = loadEnv({ NODE_ENV: 'development', AUTH_SECRET: 'x'.repeat(32) });
    expect(env.PORT).toBe(8787);
    expect(env.APP_URL).toBe('http://localhost:5173');
    expect(env.PASSKEY_RP_ID).toBe('localhost');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('generates AUTH_SECRET outside production with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = loadEnv({ NODE_ENV: 'development' });
    expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('throws in production without AUTH_SECRET', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
  });

  it('refuses ADMIN_SKIP_2FA in production', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(32), ADMIN_SKIP_2FA: 'true' }),
    ).toThrow(/ADMIN_SKIP_2FA/);
  });
});

describe('loadEnv production database', () => {
  it('requires DATABASE_URL in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40) })).toThrow(/DATABASE_URL/);
  });
});
