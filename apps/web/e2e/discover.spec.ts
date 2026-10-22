import { expect, test } from '@playwright/test';
import { createSeries, signUpAndVerify } from './helpers';

test('share a podcast publicly, find it in Discover, and play it signed out', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, 'sharer');
  await createSeries(page, 'Why does work expand to fill the time available?');
  await page.getByRole('button', { name: 'Make public' }).click();
  await expect(page.getByText(/This series is public/)).toBeVisible();
  const seriesUrl = page.url();
  const seriesId = seriesUrl.split('/series/')[1]!.split('#')[0]!;
  const detail = (await (await page.request.get(`/api/series/${seriesId}`)).json()) as { publicSlug: string; title: string };

  // Discover finds it by mental-model or description words.
  await page.getByRole('link', { name: 'Discover' }).click();
  await page.getByRole('searchbox', { name: 'Search public podcasts' }).fill('expand time available');
  await expect(page.getByRole('link', { name: new RegExp(detail.title) }).first()).toBeVisible({ timeout: 10_000 });

  // A signed-out visitor can open the link and play.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(`/p/${detail.publicSlug}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(detail.title);
  await visitor.getByRole('button', { name: /^Play episode 1/ }).click();
  await expect(visitor.getByRole('link', { name: /Open player:/ })).toBeVisible();
  // The share page carries preview tags for link previews.
  const html = await (await visitor.request.get(`/api/public/${detail.publicSlug}`)).json();
  expect(html).toMatchObject({ title: detail.title });
  await anon.close();

  // Making it private removes it from Discover and breaks the link.
  await page.goto(seriesUrl);
  await page.getByRole('button', { name: 'Make private' }).click();
  await expect(page.getByText('This series is private again.')).toBeVisible();
  expect((await page.request.get(`/api/public/${detail.publicSlug}`)).status()).toBe(404);
});

test('Continue Learning starts a follow-on series', async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndVerify(page, 'cont');
  await createSeries(page, 'How do I prioritise my week?');
  await page.getByRole('button', { name: 'Go deeper' }).click();
  await expect(page).toHaveURL(/\/generations\//);
  await expect(page.getByRole('list', { name: 'Progress' })).toBeVisible();
});
