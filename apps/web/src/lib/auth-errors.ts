export type SignInErrorKind = 'unverified' | 'banned' | 'invalid' | 'rate_limited' | 'other';

/** Better Auth signals both unverified and banned accounts with 403, so branch on the code. */
export function classifySignInError(error: { status?: number | undefined; code?: string | undefined }): SignInErrorKind {
  if (error.status === 429) return 'rate_limited';
  if (error.code === 'EMAIL_NOT_VERIFIED') return 'unverified';
  if (error.code === 'BANNED_USER') return 'banned';
  if (error.status === 401) return 'invalid';
  return 'other';
}
