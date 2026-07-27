import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const taggedFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const scanFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/mobile-camscanner.pdf', import.meta.url),
);
const outlineFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/ocg-acrobat.pdf', import.meta.url),
);

// A deliberately thin smoke test over the production artifact. Its job is to prove the
// shell mounts, the accessibility landmarks exist, and, most importantly, that the
// page issues no cross-origin request. That last assertion is the runtime counterpart
// to scripts/check-no-egress.mjs: the static scan proves no third-party URL is present
// in the bundle, this proves none is contacted when the app actually runs.
test('shell mounts and contacts nobody', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (
      url.origin !== 'http://127.0.0.1:4180' &&
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:'
    ) {
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

test('keeps command-palette focus modal and invokes a command by keyboard', async ({
  page,
}) => {
  await page.goto('/');

  const trigger = page.getByRole('button', { name: /Commands/ });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeInViewport();
  await expect(page.getByLabel('Filter commands')).toBeFocused();

  await page.getByLabel('Filter commands').fill('Use dark theme');
  await page.getByLabel('Filter commands').press('Tab');
  await expect(page.getByRole('option', { name: 'Use dark theme' })).toBeFocused();
  await page.getByRole('option', { name: 'Use dark theme' }).press('Enter');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(trigger).toBeFocused();
});

test('opens and renders a PDF through the production worker and WASM build', async ({
  page,
}) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== 'http://127.0.0.1:4180' &&
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:'
    ) {
      foreign.push(request.url());
    }
  });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Open PDF').setInputFiles(taggedFixture);

  await expect(page.getByText('1 page · LOCAL')).toBeVisible();
  await expect(page.getByLabel('Document pages')).toBeVisible();
  await expect(page.getByLabel('Analysis scope')).toContainText('DEGRADED');

  const tile = page.locator('canvas.pdf-tile:not(.pdf-highlight-tile)').first();
  await expect(tile).toBeVisible();
  await expect
    .poll(() =>
      tile.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context || canvas.width === 0 || canvas.height === 0) return false;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index + 3] === 255 &&
            (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255)
          ) {
            return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);

  const pages = page.getByLabel('Document pages');
  await pages.press('Control+0');
  await expect(page.getByLabel('Zoom level')).toHaveText('100%');
  await pages.press('Control+-');
  await expect(page.getByLabel('Zoom level')).toHaveText('83%');
  await pages.press('Control+=');
  await expect(page.getByLabel('Zoom level')).toHaveText('100%');

  await pages.press('Control+f');
  await page.getByLabel('Find in document').fill('Line');
  await page.getByLabel('Find in document').press('Enter');
  await expect(page.getByText(/matches$/)).toBeVisible();
  await pages.focus();
  await pages.press('Control+f');
  await expect(page.getByLabel('Find in document')).toBeFocused();

  await page.getByRole('button', { name: 'Pan mode' }).click();
  await expect(page.getByRole('button', { name: 'Select mode' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page
      .locator('.pdf-page')
      .first()
      .evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('none');

  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page
      .getByRole('contentinfo', { name: 'Document status' })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const closePanelBox = await page
    .getByRole('button', { name: 'Close contextual panel' })
    .boundingBox();
  expect(closePanelBox?.width).toBeGreaterThanOrEqual(44);
  expect((closePanelBox?.x ?? 321) + (closePanelBox?.width ?? 0)).toBeLessThanOrEqual(320);

  await page.getByLabel('Open PDF').setInputFiles(outlineFixture);
  await expect(page.getByText('ocg-acrobat.pdf', { exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Outline' }).click();
  await expect(page.getByRole('button', { name: 'Leere Seite' })).toBeVisible();

  await page.getByLabel('Open PDF').setInputFiles(scanFixture);
  await expect(page.getByText('12 pages · LOCAL')).toBeAttached();
  await expect(page.getByRole('status', { name: 'Current page', exact: true })).toHaveText(
    '1 / 12',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(foreign, `Cross-origin requests: ${foreign.join(', ')}`).toEqual([]);
  expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
