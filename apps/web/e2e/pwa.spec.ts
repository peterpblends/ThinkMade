import { expect, test } from '@playwright/test';

test('service worker installs and the app shell opens offline', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes service worker control reliably only in Chromium');
  await page.goto('/');
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const worker = reg.installing ?? reg.waiting ?? reg.active;
    if (worker && worker.state !== 'activated') {
      await new Promise<void>((resolve) => worker.addEventListener('statechange', () => worker.state === 'activated' && resolve()));
    }
    return (await navigator.serviceWorker.ready).active?.state;
  });
  expect(state).toBe('activated');

  await context.setOffline(true);
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await context.setOffline(false);
});
