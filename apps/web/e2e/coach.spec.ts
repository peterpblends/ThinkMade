import { expect, test } from '@playwright/test';
import { createSeries, signUpAndVerify } from './helpers';

test('Coach Me answers, remembers the conversation, and can start a new podcast from it', async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, 'coach');
  await createSeries(page);
  await page.getByRole('link', { name: 'Coach Me' }).first().click();
  await expect(page.getByText('Coach Me', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /your question/i }).fill('How would this apply to hiring decisions?');
  await page.getByRole('button', { name: 'Send' }).click();
  const log = page.getByRole('log', { name: 'Coaching conversation' });
  await expect(log).toContainText('How would this apply to hiring decisions?');
  await expect(log).toContainText('naming the alternative you are giving up');

  await page.reload();
  await expect(page.getByRole('log', { name: 'Coaching conversation' })).toContainText('How would this apply to hiring decisions?');

  await page.getByRole('button', { name: 'Create a Podcast About This' }).click();
  await expect(page).toHaveURL(/\/generations\//);
  await expect(page.getByRole('list', { name: 'Progress' })).toBeVisible();
});
