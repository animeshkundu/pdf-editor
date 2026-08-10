import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const previewDirectory = join(process.cwd(), '.factory-preview');

test('captures the populated contextual shell in both themes and densities', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Capture one deterministic screenshot set.');
  mkdirSync(previewDirectory, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'review.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(fixture),
  });
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();

  for (const [theme, density] of [
    ['light', 'compact'],
    ['light', 'comfortable'],
    ['dark', 'compact'],
    ['dark', 'comfortable'],
  ] as const) {
    await page.evaluate(
      ({ nextTheme, nextDensity }) => {
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.dataset.density = nextDensity;
      },
      { nextTheme: theme, nextDensity: density },
    );
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(
      page.getByRole('complementary', { name: 'Contextual properties' }),
    ).toContainText('Comment and Redact');
    await page.screenshot({
      path: join(previewDirectory, `contextual-${theme}-${density}.png`),
      scale: 'device',
    });
    await page.getByRole('button', { name: 'Commands' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({
      path: join(previewDirectory, `commands-${theme}-${density}.png`),
      scale: 'device',
    });
    await page.keyboard.press('Escape');
  }

  for (const tab of ['Thumbnails', 'Outline', 'Attachments', 'Search'] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await page.screenshot({
      path: join(previewDirectory, `navigator-${tab.toLowerCase()}.png`),
      scale: 'device',
    });
  }
});
