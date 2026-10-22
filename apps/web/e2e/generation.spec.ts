import { expect, test } from '@playwright/test';
import { signUpAndVerify } from './helpers';

test('topic in, real playable podcast out', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndVerify(page, 'gen');
  await page.getByRole('textbox', { name: /your topic/i }).fill('Why do projects in my team always run late?');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByText('5 min', { exact: true }).click();
  await page.getByText('1 episode', { exact: true }).click();
  await page.getByRole('button', { name: 'Create My Podcasts' }).click();

  await expect(page).toHaveURL(/\/generations\//);
  await expect(page.getByRole('list', { name: 'Progress' })).toContainText('Understanding your topic');
  await expect(page.getByRole('link', { name: 'Open your series' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Ready to listen' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Listen to episode 1/ })).toBeVisible();

  await page.getByRole('link', { name: 'Open your series' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thinking It Through');
  const audio = page.locator('audio').first();
  await expect(audio).toHaveAttribute('src', /\/api\/episodes\/.+\/audio/);
  const duration = await audio.evaluate(async (el: HTMLAudioElement) => {
    if (!Number.isFinite(el.duration) || el.duration === 0) {
      await new Promise((r) => {
        el.addEventListener('loadedmetadata', r, { once: true });
        el.load();
      });
    }
    return el.duration;
  });
  // 5 minutes of script at the test voice's pace, measured by the browser from the real MP3.
  expect(duration).toBeGreaterThan(200);
  await page.getByText("What you'll learn").first().click();
  await expect(page.getByText('Thinking', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/verified via Open Library/).first()).toBeVisible();

  await page.getByRole('link', { name: 'My Library' }).click();
  await expect(page.getByRole('link', { name: /Thinking It Through/ })).toBeVisible();
});
