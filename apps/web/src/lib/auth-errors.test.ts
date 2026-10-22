import { describe, expect, it } from 'vitest';
import { classifySignInError } from './auth-errors';

describe('classifySignInError', () => {
  it('recognises an unverified email', () => {
    expect(classifySignInError({ status: 403, code: 'EMAIL_NOT_VERIFIED' })).toBe('unverified');
  });
  it('does not tell a banned user to verify their email', () => {
    expect(classifySignInError({ status: 403, code: 'BANNED_USER' })).toBe('banned');
  });
  it('maps bad credentials and rate limits', () => {
    expect(classifySignInError({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('invalid');
    expect(classifySignInError({ status: 429 })).toBe('rate_limited');
    expect(classifySignInError({ status: 500 })).toBe('other');
  });
});
