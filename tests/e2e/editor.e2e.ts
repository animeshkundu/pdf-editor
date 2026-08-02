import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const redactionFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/latex-pdftex.pdf', import.meta.url),
);

test('MARK-001/PAGE-020 adds and undoes one interoperable annotation action', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 page · LOCAL')).toBeVisible();
  await page.getByRole('button', { name: 'Markup' }).click();
  await page.getByRole('button', { name: 'Sticky note LOCAL' }).click();
  await expect(page.getByText('1 annotation in this document')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo document change' })).toBeEnabled();

  await page.getByRole('button', { name: 'Undo document change' }).click();
  await expect(page.getByText('0 annotations in this document')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redo document change' })).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});

test('SIGN-028 redaction marks block ordinary output and never claim removal', async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(redactionFixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('28 pages · LOCAL')).toBeVisible();
  await page.getByRole('button', { name: 'Markup' }).click();
  await page.getByRole('button', { name: 'Redaction mark' }).click();

  const pdfPage = page.locator('.pdf-page').first();
  const pageBox = await pdfPage.boundingBox();
  expect(pageBox).not.toBeNull();
  if (!pageBox) return;

  await page.mouse.click(pageBox.x + 8, pageBox.y + 8);
  await expect(page.getByRole('alert')).toContainText(
    'Drag over the exact region to redact. No mark was created.',
  );
  await expect(page.getByText('0 annotations in this document')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.mouse.move(pageBox.x + 4, pageBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 12, pageBox.y + 12);
  await page.mouse.up();
  await expect(page.getByText('1 annotation in this document')).toBeVisible();

  await page.getByRole('button', { name: 'Download' }).click();
  await expect(
    page.getByRole('alert').filter({
      hasText: 'unapplied redaction mark blocks Save, Export, and Print',
    }),
  ).toBeVisible();
  expect(downloads).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss' }).click();

  const confirmRemoval = page.getByRole('checkbox', {
    name: /permanently removes their content/,
  });
  await expect(confirmRemoval).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply redaction marks' })).toBeDisabled();
  await confirmRemoval.click();
  await page.getByRole('button', { name: 'Apply redaction marks' }).click();
  const redactionOutcome = page.getByRole('status').filter({
    hasText: 'No extractable characters were removed',
  });
  await expect(redactionOutcome).toBeVisible();
  await expect(redactionOutcome).not.toContainText('Output is unblocked');
});

test('FORM-021/AUTO-006/AUTO-007 authors and observes worker-local JavaScript', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Forms' }).click();
  await page.getByLabel('Unique name').fill('amount');
  await page.getByRole('button', { name: 'Create field' }).click();
  await expect(page.getByRole('button', { name: 'amount', exact: true })).toBeVisible();

  const scripts = page
    .locator('.workflow-group')
    .filter({ hasText: 'Form and document JavaScript' });
  await scripts.getByRole('button', { name: /Form and document JavaScript/ }).click();
  await scripts.getByRole('combobox', { name: 'Script field' }).click();
  await page.getByRole('option', { name: 'amount', exact: true }).click();
  await scripts.getByLabel('JavaScript source').fill('event.rc = event.value !== "blocked";');
  await scripts.getByRole('button', { name: 'Save JavaScript action' }).click();
  await scripts.getByRole('button', { name: /Form and document JavaScript/ }).click();
  await expect(scripts.getByText('amount · validate')).toBeVisible();

  await page.getByRole('button', { name: 'amount', exact: true }).click();
  await page.getByRole('button', { name: 'Edit field value' }).click();
  await page.getByLabel('Value for amount').fill('blocked');
  await page.getByRole('button', { name: 'Set field value' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the supplied text');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page
    .locator('.active-entry')
    .filter({ has: page.getByLabel('Value for amount') })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await page.getByRole('button', { name: 'Automate' }).click();
  const console = page
    .getByRole('group')
    .filter({ hasText: 'Document JavaScript console LOCAL' });
  await console
    .getByLabel('JavaScript source')
    .fill('for (var i = 0; i < 205; i += 1) console.println(String(i)); 0;');
  await console.getByRole('button', { name: 'Run JavaScript' }).click();
  await expect(console.getByText('Console result')).toBeVisible();
  await console
    .getByLabel('JavaScript source')
    .fill(
      'this.getField("amount").value = "snapshot only"; console.println("worker only"); app.launchURL("https://blocked.example", true); 6 * 7;',
    );
  await console.getByRole('button', { name: 'Run JavaScript' }).click();
  await expect(console.getByText('42', { exact: true })).toBeVisible();
  await expect(console.getByText(/launch-url: .*blocked\.example.*Blocked\./)).toBeVisible();
  await page.getByRole('button', { name: 'amount', exact: true }).click();
  await page.getByRole('button', { name: 'Edit field value' }).click();
  await expect(page.getByLabel('Value for amount')).toHaveValue('');
  expect(consoleErrors).toEqual([]);
});

test('CMPR-004/CMPR-005 drives classified text and raster comparison in the worker', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.getByLabel('PDF to compare').setInputFiles(fixture);

  await expect(page.getByText('1 same')).toBeVisible();
  await expect(page.getByText('0 moved')).toBeVisible();
  await expect(page.getByText('RMSE 0.000')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
