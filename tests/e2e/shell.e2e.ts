import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const previewOrigin = `http://127.0.0.1:${process.env.PDF_EDITOR_E2E_PORT ?? 4180}`;
const taggedFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const scanFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/mobile-camscanner.pdf', import.meta.url),
);
const outlineFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/ocg-acrobat.pdf', import.meta.url),
);
const encryptedWorkDir = mkdtempSync(join(tmpdir(), 'pdf-editor-e2e-encrypted-'));
const encryptedFixture = join(encryptedWorkDir, 'protected.pdf');
const ownerOnlyFixture = join(encryptedWorkDir, 'owner-only.pdf');
const rc4Fixture = join(encryptedWorkDir, 'rc4.pdf');

test.beforeAll(() => {
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  const qpdf = setup.stdout.trim();
  const encrypted = spawnSync(
    qpdf,
    [
      '--encrypt',
      'reader-secret',
      'owner-secret',
      '256',
      '--',
      taggedFixture,
      encryptedFixture,
    ],
    { encoding: 'utf8', shell: false },
  );
  if (encrypted.status !== 0) throw new Error(encrypted.stderr || encrypted.stdout);
  const ownerOnly = spawnSync(
    qpdf,
    ['--encrypt', '', 'owner-secret', '256', '--', taggedFixture, ownerOnlyFixture],
    { encoding: 'utf8', shell: false },
  );
  if (ownerOnly.status !== 0) throw new Error(ownerOnly.stderr || ownerOnly.stdout);
  const rc4 = spawnSync(
    qpdf,
    [
      '--allow-weak-crypto',
      '--encrypt',
      'reader-secret',
      'owner-secret',
      '128',
      '--use-aes=n',
      '--',
      taggedFixture,
      rc4Fixture,
    ],
    { encoding: 'utf8', shell: false },
  );
  if (rc4.status !== 0) throw new Error(rc4.stderr || rc4.stdout);
});

test.afterAll(() => rmSync(encryptedWorkDir, { recursive: true, force: true }));

test('landing page publishes the mounted editor journey', async ({ page }) => {
  await page.goto('/pdf/');
  await expect(page.getByRole('heading', { name: /Serious PDF work/ })).toBeVisible();
  await expect(page.getByText('No upload. No account. No telemetry.')).toBeVisible();
  expect(
    await page
      .getByText('Quarterly review.pdf')
      .evaluate((element) => element.closest('[aria-hidden="true"]') !== null),
  ).toBe(true);
  await page.getByRole('link', { name: 'Open a PDF' }).click();
  await expect(page).toHaveURL(/\/pdf\/app\/$/);
  await expect(page.getByRole('heading', { name: 'PDF editor', level: 1 })).toBeAttached();
});

// A deliberately thin smoke test over the production artifact. Its job is to prove the
// shell mounts, the accessibility landmarks exist, and, most importantly, that the
// page issues no cross-origin request. That last assertion is the runtime counterpart
// to scripts/check-no-egress.mjs: the static scan proves no third-party URL is present
// in the bundle, this proves none is contacted when the app actually runs.
test('shell mounts and contacts nobody', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin !== previewOrigin && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      foreign.push(req.url());
    }
  });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/pdf/app/');

  await expect(page.getByRole('heading', { name: 'PDF editor', level: 1 })).toBeAttached();
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to document' })).toBeAttached();

  expect(foreign, `Cross-origin requests: ${foreign.join(', ')}`).toEqual([]);
  expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('SIGN-018 opens a protected PDF after a wrong-password retry', async ({ page }) => {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(encryptedFixture);

  const dialog = page.getByRole('dialog', { name: 'Unlock PDF' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('protected.pdf');
  const password = page.getByLabel('Document password');
  await expect(password).toBeFocused();
  await password.fill('wrong-password');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not open this PDF');

  await password.fill('reader-secret');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('1 page · LOCAL')).toBeVisible();
  const pages = page.getByLabel('Document pages');
  await expect(pages).toBeVisible();
  await pages.press('Control+f');
  await page.getByLabel('Find in document').fill('Line');
  await page.getByLabel('Find in document').press('Enter');
  await expect(page.getByText('Match 1 of 6')).toBeVisible();
});

test('SIGN-019 authenticates owner controls for an owner-only PDF', async ({ page }) => {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(ownerOnlyFixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 page · LOCAL')).toBeVisible();
  await page.getByRole('button', { name: 'Protect' }).click();
  await expect(page.getByText('Owner controls are locked')).toBeVisible();
  await page.getByLabel('Current owner password').fill('owner-secret');
  await page.getByRole('button', { name: 'Unlock owner controls' }).click();
  await expect(page.getByText('Owner controls unlocked for this local session.')).toBeVisible();
});

test('SIGN-024 opens RC4 read-only and offers only an AES-256 replacement', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(rc4Fixture);
  await page.getByLabel('Document password').fill('reader-secret');
  await page.getByRole('button', { name: 'Unlock' }).click();

  await page.getByRole('button', { name: 'Forms' }).click();
  await page.getByLabel('Unique name').fill('must-not-write');
  await page.getByRole('button', { name: 'Create field' }).click();
  await expect(page.getByRole('alert')).toContainText('broken RC4 encryption');
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.getByRole('button', { name: 'Protect' }).click();
  await expect(page.getByRole('alert')).toContainText('Weak RC4 encryption · read-only');
  await expect(
    page.getByRole('button', { name: 'Replace RC4 with AES-256 copy' }),
  ).toBeVisible();
  await expect(page.getByLabel('Encryption')).toHaveValue('aes-256');
  await expect(page.getByLabel('Encryption')).toBeDisabled();
  expect(consoleErrors).toEqual([]);
});

test('honours the density switch through the token layer', async ({ page }) => {
  await page.goto('/pdf/app/');

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
  await page.goto('/pdf/app/');

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
    if (url.origin !== previewOrigin && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      foreign.push(request.url());
    }
  });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/pdf/app/');
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
  await expect(page.getByText('Match 1 of 6')).toBeVisible();
  await page.getByLabel('Find in document').press('Enter');
  await expect(page.getByText('Match 2 of 6')).toBeVisible();
  await page.getByLabel('Find in document').press('Shift+Enter');
  await expect(page.getByText('Match 1 of 6')).toBeVisible();
  await page.keyboard.press('Shift+F3');
  await expect(page.getByText('Match 6 of 6')).toBeVisible();
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
    .getByRole('button', { name: 'Close contextual panels' })
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
