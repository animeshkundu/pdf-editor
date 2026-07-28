import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);

test('MARK-001/PAGE-020 adds and undoes one interoperable annotation action', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
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
  await page.goto('/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await expect(page.getByText('1 page · LOCAL')).toBeVisible();
  await page.getByRole('button', { name: 'Markup' }).click();
  await page
    .getByRole('button', {
      name: /Redaction mark LOCAL A mark does not remove or hide content/,
    })
    .click();
  await expect(page.getByText('1 annotation in this document')).toBeVisible();

  await page.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'unapplied redaction mark blocks Save, Export, and Print',
  );
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Protect' }).click();
  await page.getByRole('button', { name: 'Sanitize document and download' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sanitizing the document failed' }),
  ).toContainText('unapplied redaction mark blocks Save, Export, and Print');
});

test('FORM-021/AUTO-006/AUTO-007 authors and observes worker-local JavaScript', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Forms' }).click();
  await page.getByLabel('Unique name').fill('amount');
  await page.getByRole('button', { name: 'Create field' }).click();
  await expect(page.getByRole('button', { name: 'amount', exact: true })).toBeVisible();

  const scripts = page.locator('details').filter({ hasText: 'Form and document JavaScript' });
  await scripts.locator('summary').click();
  await scripts.getByRole('combobox').nth(1).selectOption('amount');
  await scripts.getByLabel('JavaScript source').fill('event.rc = event.value !== "blocked";');
  await scripts.getByRole('button', { name: 'Save JavaScript action' }).click();
  await scripts.locator('summary').click();
  await expect(scripts.getByText('amount · validate')).toBeVisible();

  await page.getByRole('button', { name: 'amount', exact: true }).click();
  await page.getByRole('button', { name: 'Edit field value' }).click();
  await page.getByLabel('Value for amount').fill('blocked');
  await page.getByRole('button', { name: 'Set field value' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the supplied text');
  await page.getByRole('button', { name: 'Dismiss' }).click();

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
  await page.getByRole('button', { name: 'Forms' }).click();
  await page.getByRole('button', { name: 'amount', exact: true }).click();
  await page.getByRole('button', { name: 'Edit field value' }).click();
  await expect(page.getByLabel('Value for amount')).toHaveValue('');
  expect(consoleErrors).toEqual([]);
});
