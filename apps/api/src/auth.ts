import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@thinkmade/db';
import type { EmailSender, ObjectStorage } from '@thinkmade/ai';
import { BRAND } from '@thinkmade/shared';
import type { Env } from './env';

export interface AuthDeps {
  db: Db;
  env: Env;
  email: EmailSender;
  /** When given, account deletion also removes the user's stored audio and uploads. */
  storage?: ObjectStorage;
}

/** Keys of every stored object that belongs to this user. */
async function userObjectKeys(db: Db, userId: string): Promise<string[]> {
  const uploads = await db.select({ key: schema.mediaUpload.objectKey }).from(schema.mediaUpload).where(eq(schema.mediaUpload.userId, userId));
  const series = await db.select({ id: schema.podcastSeries.id }).from(schema.podcastSeries).where(eq(schema.podcastSeries.userId, userId));
  const audio = series.length
    ? await db.select({ key: schema.episode.audioKey }).from(schema.episode).where(inArray(schema.episode.seriesId, series.map((s) => s.id)))
    : [];
  return [...uploads.map((u) => u.key), ...audio.map((a) => a.key).filter((k): k is string => !!k)];
}

async function deliver(email: EmailSender, to: string, subject: string, text: string) {
  const result = await email.send({ to, subject, text });
  if (!result.ok) {
    // Never pretend delivery worked: surface the failure to the caller.
    throw new Error(`Email delivery failed: ${result.error}`);
  }
}

export function createAuth({ db, env, email, storage }: AuthDeps) {
  return betterAuth({
    appName: BRAND.name,
    // The API is always served under the app origin (Vercel rewrite in production, Vite proxy locally),
    // so links and cookies use the public app URL.
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => {
        await deliver(
          email,
          user.email,
          `Reset your ${BRAND.name} password`,
          `Someone asked to reset the password for your ${BRAND.name} account.\n\nReset it here: ${url}\n\nIf this wasn't you, you can ignore this email.`,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deliver(
          email,
          user.email,
          `Confirm your email for ${BRAND.name}`,
          `Welcome to ${BRAND.name}. ${BRAND.tagline}\n\nConfirm your email address: ${url}\n\nIf you didn't create an account, you can ignore this email.`,
        );
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Rows cascade in the database; stored files must be removed explicitly.
        beforeDelete: async (user) => {
          if (!storage) return;
          for (const key of await userObjectKeys(db, user.id)) await storage.delete(key).catch(() => {});
        },
      },
    },
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [
      passkey({ rpID: env.PASSKEY_RP_ID, rpName: BRAND.name, origin: env.APP_URL }),
      twoFactor({ issuer: BRAND.name }),
      admin(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
