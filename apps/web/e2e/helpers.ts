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
  await page.getByRole('heading', { name: 'What would you like to think through today?' }).waitFor();
  return email;
}
