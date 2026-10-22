import { expect, test } from '@playwright/test';
import { createSeries, signUpAndVerify } from './helpers';

test('a downloaded episode plays offline and progress syncs when back online', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Offline service worker control is reliable only in Chromium under Playwright');
  test.setTimeout(180_000);
  await signUpAndVerify(page, 'offline');
  await createSeries(page);
  // Make sure a service worker is active before going offline.
  const swState = await page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
    const w = reg.installing ?? reg.waiting ?? reg.active;
    if (w && w.state !== 'activated') await new Promise<void>((r) => w.addEventListener('statechange', () => w.state === 'activated' && r()));
    return (await navigator.serviceWorker.ready).active?.state;
  });
  expect(swState).toBe('activated');

  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 30_000 });
  const episodeId = page.url().split('/series/')[1]!.split('#')[0];
  const ep = await page.request.get(`/api/series/${episodeId}`).then((r) => r.json() as Promise<{ episodes: Array<{ id: string }> }>);
  const id = ep.episodes[0]!.id;

  await context.setOffline(true);
  await page.goto('/library');
  await expect(page.getByRole('status').filter({ hasText: "You're offline" }).first()).toBeVisible();
  // Offline, the library goes straight to downloads (the account cannot be checked without a connection).
  const downloadsTab = page.getByRole('tab', { name: 'Downloads' });
  if (await downloadsTab.isVisible()) await downloadsTab.click();
  await expect(page.getByText(/1 episode · .* MB on this device/)).toBeVisible();
  await page.getByRole('button', { name: /^Play / }).first().click();
  await page.getByRole('link', { name: /Open player:/ }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: /^Favorite/ }).click();
  await expect(page.getByRole('button', { name: /Favorited/ })).toBeVisible();

  // Back online: queued progress and favourite reach the server.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await (await page.request.get(`/api/playback/${id}`)).json()) as { positionMs: number; favorite: boolean }, { timeout: 20_000 })
    .toMatchObject({ favorite: true, positionMs: expect.any(Number) });
  const server = (await (await page.request.get(`/api/playback/${id}`)).json()) as { positionMs: number };
  expect(server.positionMs).toBeGreaterThanOrEqual(44_000);
});
