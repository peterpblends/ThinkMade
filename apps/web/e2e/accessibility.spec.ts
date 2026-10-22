import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createSeries, signUpAndVerify } from './helpers';

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

test('signed-out screens have no serious accessibility problems', async ({ page }) => {
  for (const path of ['/', '/sign-in', '/sign-up', '/forgot-password', '/help', '/discover', '/library', '/report-bug']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await audit(page, path);
  }
});

test('signed-in screens have no serious accessibility problems', async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, 'a11y');
  await audit(page, 'create (signed in)');
  await page.getByRole('button', { name: 'Customize' }).click();
  await audit(page, 'customize');
  await page.goto('/');
  await createSeries(page);
  await audit(page, 'series');
  await page.getByRole('button', { name: /^Play episode 1/ }).click();
  await audit(page, 'series with mini player');
  await page.getByRole('link', { name: /Open player:/ }).click();
  await audit(page, 'player');
  await page.goto('/library');
  await audit(page, 'library');
  await page.goto('/settings');
  await audit(page, 'settings');
});
