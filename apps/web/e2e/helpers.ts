import type { Page } from '@playwright/test';

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Reads the last email sent to `to` from the test-only API endpoint. */
export async function lastEmailLink(page: Page, to: string): Promise<string> {
  const res = await page.request.get(`/api/_test/last-email?to=${encodeURIComponent(to)}`);
  if (!res.ok()) throw new Error(`no email for ${to}: ${res.status()}`);
  const { text } = (await res.json()) as { text: string };
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error('no link in email');
  return match[0];
}

export async function signUp(page: Page, email: string, password = 'correct-horse-battery') {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Test Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Signs up, follows the verification link, and lands on Create signed in. */
export async function signUpAndVerify(page: Page, prefix: string) {
  const email = uniqueEmail(prefix);
  await signUp(page, email);
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  await page.goto(await lastEmailLink(page, email));
  await page.getByRole('heading', { name: 'What would you like to think through?' }).waitFor();
  return email;
}

/** Creates a 5-minute, one-episode series through the UI and opens it. */
export async function createSeries(page: Page, topic = 'Why do projects run late?') {
  await page.getByRole('textbox', { name: /your topic/i }).fill(topic);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByText('5 min', { exact: true }).click();
  await page.getByText('1 episode', { exact: true }).click();
  await page.getByRole('button', { name: 'Create My Podcasts' }).click();
  await page.getByRole('link', { name: 'Open your series' }).waitFor({ timeout: 90_000 });
  await page.getByRole('link', { name: 'Open your series' }).click();
  await page.getByRole('button', { name: /^Play episode 1/ }).waitFor();
}

import { createHmac } from 'node:crypto';

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** RFC 6238 TOTP, as an authenticator app computes it. */
export function totp(secretBase32: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** Creates a verified admin with two-step verification turned on, signed in on `page`. */
export async function signInAsAdmin(page: Page) {
  const email = await signUpAndVerify(page, 'admin');
  await page.request.post(`/api/_test/make-admin?email=${encodeURIComponent(email)}`);
  const enable = await page.request.post('/api/auth/two-factor/enable', { data: { password: 'correct-horse-battery' }, headers: { origin: new URL(page.url()).origin } });
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get('secret')!;
  const verify = await page.request.post('/api/auth/two-factor/verify-totp', { data: { code: totp(secret) }, headers: { origin: new URL(page.url()).origin } });
  if (!verify.ok()) throw new Error(`2FA verify failed: ${verify.status()}`);
  return email;
}
