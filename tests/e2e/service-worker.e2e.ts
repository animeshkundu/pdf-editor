import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const manifest = readFileSync(
  fileURLToPath(new URL('../../vendor/wasm-manifest.json', import.meta.url)),
  'utf8',
);
const manifestDigest = createHash('sha256').update(manifest).digest('hex');
const serviceWorkerSource = readFileSync(
  fileURLToPath(new URL('../../.vercel/output/static/pdf-editor/app/sw.js', import.meta.url)),
  'utf8',
);
const shellDocument = readFileSync(
  fileURLToPath(
    new URL('../../.vercel/output/static/pdf-editor/app/index.html', import.meta.url),
  ),
);
const shellDocumentDigest = createHash('sha256').update(shellDocument).digest('hex');
const cacheVersion = /const CACHE_VERSION = "([a-f0-9]{24})";/.exec(serviceWorkerSource)?.[1];

test('AC-6 caches the mounted app and engine with a manifest-versioned upgrade', async ({
  page,
  context,
}) => {
  await page.goto('/pdf/');
  await page.evaluate(async () => {
    const stale = await caches.open('papertrail-app-stale-manifest');
    await stale.put(
      '/pdf-editor/app/assets/mupdf-wasm-stale.wasm',
      new Response('stale engine'),
    );
  });

  expect(serviceWorkerSource).toContain(`const WASM_MANIFEST_DIGEST = "${manifestDigest}";`);
  expect(serviceWorkerSource).toContain(
    `const SHELL_DOCUMENT_DIGEST = "${shellDocumentDigest}";`,
  );
  expect(cacheVersion).toMatch(/^[a-f0-9]{24}$/);
  expect(cacheVersion).not.toBe(manifestDigest.slice(0, 24));
  expect(serviceWorkerSource).not.toContain('"index.html"');
  expect(serviceWorkerSource).not.toContain('"ocr/');
  expect(serviceWorkerSource).toContain('storage?.estimate?.()');
  expect(serviceWorkerSource).toContain("CACHE_NAME + '-installing'");
  expect(serviceWorkerSource).not.toContain('skipWaiting');

  await page.goto('/pdf/app/');
  await page.waitForFunction(
    () =>
      navigator.serviceWorker.controller !== null &&
      document.documentElement.dataset.offlineCache === 'ready',
    undefined,
    { timeout: 30_000 },
  );
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).toEqual([`papertrail-app-${cacheVersion}`]);
  await expect(page.getByText('LOCAL · Offline ready')).toBeVisible();

  await context.setOffline(true);
  await page.goto('/pdf/app/?offline=1');
  await expect(page.getByRole('heading', { name: 'PDF editor', level: 1 })).toBeAttached();
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});
