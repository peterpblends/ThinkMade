import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers';

test('a bug report reaches the admin dashboard, which can change its status', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // A signed-out visitor reports a bug.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto('/report-bug');
  const unique = `Play button frozen ${Date.now()}`;
  await visitor.getByLabel('What happened?').fill(unique);
  await visitor.getByText('What else is sent').click();
  await expect(visitor.getByText('"userAgent"')).toBeVisible();
  await visitor.getByRole('button', { name: 'Send report' }).click();
  await expect(visitor.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await anon.close();

  await signInAsAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Free-tier allowances')).toBeVisible();

  await page.getByRole('link', { name: 'Bug reports' }).click();
  const card = page.locator('li').filter({ hasText: unique });
  await expect(card).toBeVisible();
  await card.getByRole('combobox').selectOption('in_progress');
  await page.reload();
  await expect(page.locator('li').filter({ hasText: unique }).getByRole('combobox')).toHaveValue('in_progress');

  await page.getByRole('link', { name: 'Prompts' }).click();
  await expect(page.getByText('In use: built-in')).toBeVisible();
  await page.getByRole('link', { name: 'AI models' }).click();
  await expect(page.getByRole('heading', { name: 'Script writing' })).toBeVisible();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('bug.status').first()).toBeVisible();
});

test('admin tools stay closed to normal listeners', async ({ page }) => {
  const { signUpAndVerify } = await import('./helpers');
  await signUpAndVerify(page, 'listener');
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toContainText(/do not have access/);
});
