import { createAuthClient } from 'better-auth/react';
import { adminClient, twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/** The API lives under /api on the same origin as the app (Vercel rewrite, Vite proxy locally). */
export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  basePath: '/api/auth',
  plugins: [
    passkeyClient(),
    adminClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get('next') ?? '/';
        window.location.assign(`/two-factor?next=${encodeURIComponent(next)}`);
      },
    }),
  ],
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role?: string | null;
  twoFactorEnabled?: boolean | null;
};

export function useSession() {
  const { data, isPending, refetch } = authClient.useSession();
  const user = (data?.user ?? null) as SessionUser | null;
  return { user, isPending, refetch };
}

export function isAdmin(user: SessionUser | null): boolean {
  return Boolean(user?.role?.split(',').map((r) => r.trim()).includes('admin'));
}

export function supportsPasskeys(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/** Only allow same-origin relative paths as post-auth destinations. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
