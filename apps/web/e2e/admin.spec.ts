import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createSeries, signInAsAdmin } from './helpers';

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

test('the activity report shows what was generated and rated', async ({ page }) => {
  test.setTimeout(180_000);
  const email = await signInAsAdmin(page);
  await page.goto('/');
  await createSeries(page, 'How do habits form?');
  const seriesId = page.url().split('/series/')[1]!.split(/[?#]/)[0]!;
  const series = (await (await page.request.get(`/api/series/${seriesId}`)).json()) as { title: string; episodes: Array<{ id: string; title: string }> };
  const origin = new URL(page.url()).origin;
  expect((await page.request.put(`/api/ratings/${series.episodes[0]!.id}`, { data: { stars: 5 }, headers: { origin } })).ok()).toBe(true);

  await page.goto('/admin');
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity report' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(email) }).click();
  await expect(page.getByText(series.title).first()).toBeVisible();
  await expect(page.getByText('Finished').first()).toBeVisible();
  await page.getByRole('button', { name: /^Ratings/ }).click();
  await expect(page.getByText(series.episodes[0]!.title)).toBeVisible();
  await expect(page.getByRole('img', { name: '5 out of 5 stars' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.failureSummary ?? '')).slice(0, 3).join(' | ')}`)).toEqual([]);
  if (process.env.REPORT_SHOTS) await page.screenshot({ path: `${process.env.REPORT_SHOTS}/report-${test.info().project.name}.png`, fullPage: true });
});

test('admin tools stay closed to normal listeners', async ({ page }) => {
  const { signUpAndVerify } = await import('./helpers');
  await signUpAndVerify(page, 'listener');
  await page.goto('/admin');
  await expect(page.getByRole('alert')).toContainText(/do not have access/);
});
