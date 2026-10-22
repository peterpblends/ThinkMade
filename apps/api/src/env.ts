import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PGLITE_DIR: z.string().default('.data/pglite'),
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:8787'),
  PASSKEY_RP_ID: z.string().default('localhost'),
  ADMIN_SKIP_2FA: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  /** Credential POSTs allowed per IP per 15 minutes. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Env = Omit<z.infer<typeof envSchema>, 'AUTH_SECRET' | 'ADMIN_SKIP_2FA'> & {
  AUTH_SECRET: string;
  ADMIN_SKIP_2FA: boolean;
  /** Short commit sha on Vercel, 'dev' elsewhere. */
  APP_VERSION: string;
};

/** Validates environment variables. Generates a throwaway AUTH_SECRET outside production. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.parse(source);
  const isProd = parsed.NODE_ENV === 'production';
  if (isProd && !parsed.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is required in production (at least 32 characters).');
  }
  if (isProd && parsed.ADMIN_SKIP_2FA === 'true') {
    throw new Error('ADMIN_SKIP_2FA must not be set in production.');
  }
  if (isProd && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production. The embedded database is for local development only.');
  }
  let secret = parsed.AUTH_SECRET;
  if (!secret) {
    secret = randomBytes(32).toString('base64');
    console.warn(
      '[env] AUTH_SECRET is not set; generated a temporary secret. Sessions will not survive a restart.',
    );
  }
  return {
    ...parsed,
    AUTH_SECRET: secret,
    ADMIN_SKIP_2FA: parsed.ADMIN_SKIP_2FA === 'true',
    APP_VERSION: parsed.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
