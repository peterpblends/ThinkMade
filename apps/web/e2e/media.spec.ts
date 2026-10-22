import { expect, test } from '@playwright/test';
import { signUpAndVerify } from './helpers';

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a photo alone is enough to create a podcast', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, 'photo');
  await page.getByLabel('Add a photo').setInputFiles({ name: 'workstation.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: /workstation\.png/ })).toBeVisible();
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByText('5 min', { exact: true }).click();
  await page.getByText('1 episode', { exact: true }).click();
  await page.getByRole('button', { name: 'Create My Podcasts' }).click();
  await expect(page).toHaveURL(/\/generations\//, { timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Open your series' })).toBeVisible({ timeout: 90_000 });
});

test('a disguised file is refused', async ({ page }) => {
  await signUpAndVerify(page, 'fake');
  await page.getByLabel('Add a photo').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>'.padEnd(64)) });
  await page.getByRole('button', { name: 'Create My Podcasts' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /photo|video/i })).toBeVisible();
  await expect(page).not.toHaveURL(/\/generations\//);
});
