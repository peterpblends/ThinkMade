import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';
import { schema, type Db } from '@thinkmade/db';
import type { EmailSender } from '@thinkmade/ai';
import { BRAND } from '@thinkmade/shared';
import type { Env } from './env';

export interface AuthDeps {
  db: Db;
  env: Env;
  email: EmailSender;
}

async function deliver(email: EmailSender, to: string, subject: string, text: string) {
  const result = await email.send({ to, subject, text });
  if (!result.ok) {
    // Never pretend delivery worked: surface the failure to the caller.
    throw new Error(`Email delivery failed: ${result.error}`);
  }
}

export function createAuth({ db, env, email }: AuthDeps) {
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
      deleteUser: { enabled: true },
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
