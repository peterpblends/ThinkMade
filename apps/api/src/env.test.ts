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

describe('local start-up without configuration', () => {
  it('boots without env: embedded database, generated secret, healthy API', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createContext } = await import('./create-context');
    const { createApp } = await import('./app');
    const ctx = await createContext({ env: loadEnv({}), pgliteDir: ':memory:' });
    try {
      const res = await createApp(ctx).request('/api/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, db: 'pglite' });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('AUTH_SECRET'))).toHaveLength(1);
    } finally {
      await ctx.close();
      warn.mockRestore();
    }
  });
});

describe('production origins', () => {
  const base = { NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h/db' };

  it('requires APP_URL in production instead of defaulting to localhost', () => {
    expect(() => loadEnv(base)).toThrow(/APP_URL/);
  });

  it('derives the passkey relying party from APP_URL', () => {
    const env = loadEnv({ ...base, APP_URL: 'https://thinkmade.zicaworld.com' });
    expect(env.PASSKEY_RP_ID).toBe('thinkmade.zicaworld.com');
    expect(env.API_URL).toBe('https://thinkmade.zicaworld.com');
  });

  it('uses the per-deployment Vercel URL for preview deployments', () => {
    const env = loadEnv({ ...base, VERCEL_ENV: 'preview', VERCEL_URL: 'thinkmade-abc123.vercel.app' });
    expect(env.APP_URL).toBe('https://thinkmade-abc123.vercel.app');
    expect(env.PASSKEY_RP_ID).toBe('thinkmade-abc123.vercel.app');
  });

  it('only trusts the app origin in production', () => {
    const env = loadEnv({ ...base, APP_URL: 'https://thinkmade.zicaworld.com' });
    expect(env.TRUSTED_ORIGINS).toEqual(['https://thinkmade.zicaworld.com']);
  });
});
