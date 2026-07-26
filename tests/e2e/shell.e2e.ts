import { expect, test } from '@playwright/test';

// A deliberately thin smoke test over the production artifact. Its job is to prove the
// shell mounts, the accessibility landmarks exist, and — most importantly — that the
// page issues no cross-origin request. That last assertion is the runtime counterpart
// to scripts/check-no-egress.mjs: the static scan proves no third-party URL is present
// in the bundle, this proves none is contacted when the app actually runs.
test('shell mounts and contacts nobody', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:4180' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      foreign.push(req.url());
    }
  });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'PDF editor', level: 1 })).toBeAttached();
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to document' })).toBeAttached();

  expect(foreign, `Cross-origin requests: ${foreign.join(', ')}`).toEqual([]);
  expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('honours the density switch through the token layer', async ({ page }) => {
  await page.goto('/');

  const rowHeight = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--row-height').trim(),
    );

  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  const comfortable = await rowHeight();

  await page.evaluate(() => document.documentElement.setAttribute('data-density', 'compact'));
  const compact = await rowHeight();

  await page.evaluate(() => document.documentElement.setAttribute('data-density', 'touch'));
  const touch = await rowHeight();

  // One semantic token name, three resolved values, no conditional CSS in components.
  expect(parseInt(compact)).toBeLessThan(parseInt(comfortable));
  expect(parseInt(touch)).toBeGreaterThan(parseInt(comfortable));
});
