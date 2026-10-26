import { expect, test } from '@playwright/test';
import { BRAND } from '@thinkmade/shared';

test('landing shows name, tagline and purpose', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'ThinkMade' }).first()).toBeVisible();
  await expect(page.getByText('Better Thinking. Made Personal.').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What would you like to think through?' })).toBeVisible();
  await expect(page.getByText(BRAND.purpose)).toBeVisible();
  await expect(page.getByText("A challenge you're facing, a decision you're making, or something you want to understand better.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create My Podcasts' })).toBeVisible();
});

test('no horizontal overflow on phone-sized screens', async ({ page }) => {
  for (const path of ['/', '/discover', '/library', '/sign-in', '/sign-up', '/help', '/forgot-password']) {
    await page.goto(path);
    if (path === '/') {
      await page.getByRole('textbox', { name: /your topic/i }).fill('x'.repeat(400));
      await page.getByRole('button', { name: 'Customize' }).click();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('bottom nav items are at least 44px tall and point to the three tabs', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const links = nav.getByRole('link');
  await expect(links).toHaveText(['Create', 'Discover', 'My Library']);
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('manifest is served with the ThinkMade name and a 512 maskable icon', async ({ page }) => {
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe('ThinkMade');
  expect(manifest.short_name).toBe('ThinkMade');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toContainEqual(
    expect.objectContaining({ src: '/icons/maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
  );
});

test('security headers reach the browser from the API', async ({ page }) => {
  const res = await page.request.get('/api/health');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('viewport asks Android to resize content for the keyboard so the tab bar stays reachable', async ({ page }) => {
  await page.goto('/');
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('interactive-widget=resizes-content');
});

test('opening splash animates the logo, then shows the Create page', async ({ page }) => {
  await page.goto('/?splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toContainText('Better Thinking. Made Personal.');
  await expect(splash).toBeHidden({ timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Create My Podcasts' })).toBeVisible();
});
