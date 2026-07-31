import { expect, test } from '@playwright/test';

test('toolbar, platform shortcut, Radix density, and wide empty state stay coherent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/pdf/app/');

  const commands = page.getByRole('button', { name: 'Commands' });
  await expect(commands).toBeVisible();
  await expect(commands).toContainText('Ctrl K');
  const welcome = page.locator('.welcome');
  const copy = welcome.locator('.welcome-copy');
  const features = welcome.locator('.welcome-features');
  const copyBox = await copy.boundingBox();
  const featureBox = await features.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(featureBox).not.toBeNull();
  expect(featureBox?.x).toBeGreaterThan((copyBox?.x ?? 0) + (copyBox?.width ?? 0));

  const density = page.getByRole('combobox', { name: 'Interface density' });
  await density.focus();
  await density.press('Enter');
  await page.getByRole('option', { name: 'Compact' }).focus();
  await page.getByRole('option', { name: 'Compact' }).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  await page.setViewportSize({ width: 780, height: 640 });
  const toolbar = page.getByRole('banner', { name: 'Global toolbar' });
  const boxes = await toolbar.locator('button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
  );
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]?.left).toBeGreaterThanOrEqual(boxes[index - 1]?.right ?? 0);
  }

  await page.setViewportSize({ width: 320, height: 640 });
  const narrowBoxes = await toolbar.locator('button:visible').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
  );
  for (let index = 1; index < narrowBoxes.length; index += 1) {
    expect(narrowBoxes[index]?.left).toBeGreaterThanOrEqual(narrowBoxes[index - 1]?.right ?? 0);
  }
  expect(narrowBoxes[0]?.left).toBeGreaterThanOrEqual(0);
});
