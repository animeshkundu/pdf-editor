import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/mobile-camscanner.pdf', import.meta.url),
);
let qpdf = '';

test.beforeAll(() => {
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  qpdf = setup.stdout.trim();
});

test('CONV-017 and CONV-019 run bundled OCR lazily and produce an independent-reader PDF', async ({
  page,
}) => {
  // Recognition takes about 70s in Firefox running alone and longer under the
  // suite's parallel load, against 60s for the rest of the suite.
  test.setTimeout(240_000);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/pdf/app/');
  await expect(page.getByRole('heading', { name: 'PDF editor', level: 1 })).toBeAttached();
  expect(requests.some((url) => new URL(url).pathname.includes('/ocr/'))).toBe(false);

  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const convert = page.getByRole('region', { name: 'Convert and validate' });
  await expect(convert).toContainText('bundled Tesseract LSTM engine');
  await convert.getByRole('button', { name: 'Recognize current page' }).click();

  const recognized = convert.getByLabel('Recognized page text');
  await expect(recognized).not.toHaveValue('', { timeout: 180_000 });
  await expect(convert.getByText(/Overall confidence:/)).toBeVisible();
  await expect(convert.getByText(/recognized words/)).toBeVisible();

  const ocrRequests = requests.filter((url) => new URL(url).pathname.includes('/ocr/'));
  const ocrPaths = ocrRequests.map((url) => new URL(url).pathname);
  expect(ocrPaths).toContain('/pdf/app/ocr/tesseract-7.0.0/worker.min.js');
  expect(ocrPaths).toContain('/pdf/app/ocr/eng-1.0.0/eng.traineddata.gz');
  expect(ocrRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(
    true,
  );

  const download = page.waitForEvent('download');
  await convert.getByRole('button', { name: 'Download searchable PDF' }).click();
  const result = await download;
  const output = await result.path();
  if (!output) throw new Error('Searchable OCR output has no local path.');

  const qpdfResult = spawnSync(qpdf, ['--check', output], {
    encoding: 'utf8',
    shell: false,
  });
  expect(qpdfResult.status, qpdfResult.stderr || qpdfResult.stdout).toBe(0);

  const task = getDocument({ data: new Uint8Array(readFileSync(output)) });
  const document = await task.promise;
  try {
    expect(document.numPages).toBe(1);
    const pdfPage = await document.getPage(1);
    try {
      const text = await pdfPage.getTextContent();
      expect(
        text.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim().length,
      ).toBeGreaterThan(20);
    } finally {
      pdfPage.cleanup();
    }
  } finally {
    await task.destroy();
  }
});
