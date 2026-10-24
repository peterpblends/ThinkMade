import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PGLITE_DIR: z.string().default('.data/pglite'),
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  APP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  API_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PASSKEY_RP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  ADMIN_SKIP_2FA: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  /** Comma-separated addresses that become administrators once verified (bootstraps the first admin). */
  ADMIN_EMAILS: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Credential POSTs allowed per IP per 15 minutes. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Env = Omit<z.infer<typeof envSchema>, 'AUTH_SECRET' | 'ADMIN_SKIP_2FA' | 'APP_URL' | 'API_URL' | 'PASSKEY_RP_ID' | 'ADMIN_EMAILS'> & {
  AUTH_SECRET: string;
  /** Public origin of the app; the API is served under it at /api. */
  APP_URL: string;
  API_URL: string;
  PASSKEY_RP_ID: string;
  /** Origins Better Auth accepts for state-changing requests. Production trusts only APP_URL. */
  TRUSTED_ORIGINS: string[];
  ADMIN_SKIP_2FA: boolean;
  /** Lower-cased addresses that become administrators once verified. */
  ADMIN_EMAILS: string[];
  /** Short commit sha on Vercel, 'dev' elsewhere. */
  APP_VERSION: string;
};

export function adminEmails(list: string | undefined): string[] {
  return (list ?? '').split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
}

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
  // Vercel previews get a new hostname per deployment, so derive it rather than configure it.
  const appUrl =
    parsed.APP_URL ??
    (parsed.VERCEL_ENV === 'preview' && parsed.VERCEL_URL ? `https://${parsed.VERCEL_URL}` : undefined) ??
    (isProd ? undefined : 'http://localhost:5173');
  if (!appUrl) {
    throw new Error('APP_URL is required in production (e.g. https://thinkmade.zicaworld.com).');
  }

  let secret = parsed.AUTH_SECRET;
  if (!secret) {
    secret = randomBytes(32).toString('base64');
    console.warn(
      '[env] AUTH_SECRET is not set; generated a temporary secret. Sessions will not survive a restart.',
    );
  }
  const apiUrl = parsed.API_URL ?? (isProd ? appUrl : 'http://localhost:8787');
  return {
    ...parsed,
    APP_URL: appUrl,
    API_URL: apiUrl,
    PASSKEY_RP_ID: parsed.PASSKEY_RP_ID ?? new URL(appUrl).hostname,
    TRUSTED_ORIGINS: isProd ? [appUrl] : [...new Set([appUrl, apiUrl])],
    AUTH_SECRET: secret,
    ADMIN_SKIP_2FA: parsed.ADMIN_SKIP_2FA === 'true',
    ADMIN_EMAILS: adminEmails(parsed.ADMIN_EMAILS),
    APP_VERSION: parsed.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
