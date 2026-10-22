import { expect, test } from '@playwright/test';
import { createSeries, signUpAndVerify } from './helpers';

test('playback position is saved and resumed; the mini player follows across screens', async ({ page }) => {
  test.setTimeout(150_000);
  await signUpAndVerify(page, 'player');
  await createSeries(page);

  await page.getByRole('button', { name: /^Play episode 1/ }).click();
  const mini = page.getByRole('link', { name: /Open player:/ });
  await expect(mini).toBeVisible();

  await mini.click();
  await expect(page.getByText(/Mental model:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await page.getByRole('button', { name: /Playback speed 1x/ }).click();
  await expect(page.getByRole('button', { name: /Playback speed 1.25x/ })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const slider = page.getByRole('slider', { name: 'Position' });
  const saved = Number(await slider.inputValue());
  expect(saved).toBeGreaterThanOrEqual(29);

  await page.getByRole('button', { name: /Favorite/ }).click();
  await expect(page.getByRole('button', { name: /Favorited/ })).toBeVisible();
  await page.getByRole('radio', { name: '4 stars' }).click();

  // Navigate away: the mini player stays.
  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(page.getByRole('link', { name: /Open player:/ })).toBeVisible();

  // Reload: the saved position comes back from the server.
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('link', { name: 'My Library' }).click();
  await expect(page.getByRole('tab', { name: 'Continue Listening' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/left/)).toBeVisible();
  await page.getByRole('tab', { name: 'Favorites' }).click();
  await expect(page.getByRole('link', { name: /Episode 1/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Continue Listening' }).click();
  await page.getByRole('button', { name: /^Play / }).first().click();
  await page.getByRole('link', { name: /Open player:/ }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Position' }).inputValue()), { timeout: 15_000 }).toBeGreaterThanOrEqual(saved - 2);
});
