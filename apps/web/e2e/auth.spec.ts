import { expect, test } from '@playwright/test';
import { lastEmailLink, signUp, uniqueEmail } from './helpers';

test('sign up, verify by email link, and land signed in', async ({ page }) => {
  const email = uniqueEmail('flow');
  await signUp(page, email);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await lastEmailLink(page, email));
  await expect(page.getByRole('heading', { name: 'What would you like to think through?' })).toBeVisible();
  await page.getByRole('button', { name: /account menu/i }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('signed-out Create keeps the question and asks the visitor to sign up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: /your topic/i }).fill('How can I become a better leader?');
  await page.getByRole('button', { name: 'Create My Podcasts' }).click();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /your topic/i })).toHaveValue('How can I become a better leader?');
});

test('unverified user sees a verification notice with resend on sign-in', async ({ page }) => {
  const email = uniqueEmail('unverified');
  await signUp(page, email);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/verify your email/i);
  await expect(page.getByRole('button', { name: /resend/i })).toBeVisible();
});

test('passkey button hidden without WebAuthn', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulate a browser without WebAuthn
    delete window.PublicKeyCredential;
  });
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /passkey/i })).toHaveCount(0);
});

test('passkey button shown when WebAuthn exists', async ({ page }) => {
  await page.goto('/sign-in');
  const supported = await page.evaluate(() => typeof window.PublicKeyCredential !== 'undefined');
  test.skip(!supported, 'browser has no WebAuthn');
  await expect(page.getByRole('button', { name: /passkey/i })).toBeVisible();
});

test('signed-in pages redirect to sign-in when signed out', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in/);
});
