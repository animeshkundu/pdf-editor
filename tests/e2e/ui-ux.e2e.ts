import { expect, test, type Download, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/distiller-tagged-linearized.pdf', import.meta.url),
);
const multipageFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/ghostscript.pdf', import.meta.url),
);
const secondFixture = fileURLToPath(
  new URL('../fixtures/pdf-corpus/ocg-acrobat.pdf', import.meta.url),
);
const encryptedWorkDir = mkdtempSync(join(tmpdir(), 'pdf-editor-ui-ux-'));
const encryptedFixture = join(encryptedWorkDir, 'protected.pdf');
const screenshotDirectory = join(process.cwd(), 'screenshots', 'ui-sweep');
let qpdfPath = '';
const panelSurfaces = [
  'Pages',
  'Outline',
  'Files',
  'Find',
  'Markup',
  'Comments',
  'Organize',
  'Forms',
  'Protect',
  'Compare',
  'Convert',
  'Access',
  'Print',
  'Automate',
  'History',
  'Scope',
] as const;

interface RuntimeGuard {
  readonly foreign: string[];
  readonly errors: string[];
}

const guards = new WeakMap<Page, RuntimeGuard>();

function guardRuntime(page: Page): RuntimeGuard {
  const guard: RuntimeGuard = { foreign: [], errors: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== 'http://127.0.0.1:4180' &&
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:'
    ) {
      guard.foreign.push(request.url());
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') guard.errors.push(message.text());
  });
  page.on('pageerror', (error) => guard.errors.push(error.message));
  return guard;
}

async function expectValidPdf(download: Download, password?: string) {
  const path = await download.path();
  if (!path) throw new Error(`Download ${download.suggestedFilename()} has no local path.`);
  const result = spawnSync(
    qpdfPath,
    [...(password ? [`--password=${password}`] : []), '--check', path],
    { encoding: 'utf8', shell: false },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

async function openFixture(page: Page, name = 'review.pdf') {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: readFileSync(fixture),
  });
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();
}

async function capture(page: Page, browserName: string, name: string) {
  if (browserName !== 'chromium') return;
  await page.screenshot({ path: join(screenshotDirectory, name) });
}

async function expectFocusTrap(page: Page, dialogName: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  const focusedInside = () =>
    dialog.evaluate((element) => element.contains(document.activeElement));
  expect(await focusedInside()).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await focusedInside()).toBe(true);
  await page.keyboard.press('Tab');
  expect(await focusedInside()).toBe(true);
}

async function resolvedContrast(page: Page, foreground: string, background: string) {
  return page.evaluate(
    ({ foregroundToken, backgroundToken }) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${foregroundToken})`;
      probe.style.backgroundColor = `var(${backgroundToken})`;
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const parse = (value: string) =>
        (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => Number(channel));
      const luminance = (channels: number[]) =>
        channels.reduce((sum, channel, index) => {
          const normalized = channel / 255;
          const linear =
            normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
        }, 0);
      const foregroundLuminance = luminance(parse(style.color));
      const backgroundLuminance = luminance(parse(style.backgroundColor));
      probe.remove();
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    },
    { foregroundToken: foreground, backgroundToken: background },
  );
}

test.beforeEach(async ({ page }) => {
  guards.set(page, guardRuntime(page));
});

test.beforeAll(() => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  qpdfPath = setup.stdout.trim();
  const encrypted = spawnSync(
    qpdfPath,
    ['--encrypt', 'reader-secret', 'owner-secret', '256', '--', fixture, encryptedFixture],
    { encoding: 'utf8', shell: false },
  );
  if (encrypted.status !== 0) throw new Error(encrypted.stderr || encrypted.stdout);
});

test.afterAll(() => rmSync(encryptedWorkDir, { recursive: true, force: true }));

test.afterEach(async ({ page }) => {
  const guard = guards.get(page);
  expect(guard, 'runtime guard was installed').toBeDefined();
  expect(guard?.foreign, `Cross-origin requests: ${guard?.foreign.join(', ')}`).toEqual([]);
  expect(guard?.errors, `Console errors: ${guard?.errors.join(' | ')}`).toEqual([]);
});

test('keeps the production document shell structurally ready and titles long documents', async ({
  page,
  browserName,
}) => {
  const longName = `${'Quarterly-local-review-'.repeat(12)}final.pdf`;
  await openFixture(page, longName);

  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(longName.replace('.', '\\.')));
  const title = page.locator('.document-title strong');
  await expect(title).toHaveText(longName);

  for (const width of [1600, 1280, 1100, 900, 780, 380]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(title).toBeVisible();
    expect(
      await title.evaluate(
        (element) =>
          getComputedStyle(element).textOverflow === 'ellipsis' &&
          element.scrollWidth >= element.clientWidth,
      ),
      `document title is truncated at ${width}px`,
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      `page overflows horizontally at ${width}px`,
    ).toBe(true);
    if (width === 780) {
      expect((await title.boundingBox())?.width ?? 0).toBeGreaterThan(0);
      const theme = page.getByRole('button', { name: /Use (dark|light) theme/ });
      const themeBox = await theme.boundingBox();
      expect(themeBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((themeBox?.x ?? 781) + (themeBox?.width ?? 0)).toBeLessThanOrEqual(width);
    }
  }
  await capture(page, browserName, 'long-title-narrow.png');
});

test('resets tools from property controls and exposes keyboard tool families', async ({
  page,
  browserName,
}) => {
  await openFixture(page);
  const status = page.getByRole('contentinfo', { name: 'Document status' });
  await expect(status).toContainText(/Tool:\s*Select and pan/i);
  const mode = status.locator('.status-mode-control');
  await mode.click();
  await expect(mode).toHaveText('Select mode');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomBeforeToolChange = await page.getByLabel('Zoom level').textContent();

  for (const [shortcut, tool] of [
    ['m', 'Note'],
    ['Shift+M', 'Highlight'],
    ['Shift+M', 'Free text'],
  ] as const) {
    await page.keyboard.press(shortcut);
    await expect(status).toContainText(new RegExp(`Tool:\\s*${tool}`, 'i'));
    await expect(page.getByLabel('Zoom level')).toHaveText(zoomBeforeToolChange ?? '');
    await expect(mode).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('Escape');
  await expect(status).toContainText(/Tool:\s*Select and pan/i);
  await page.keyboard.press('d');
  await expect(status).toContainText(/Tool:\s*Ink/i);
  await page.keyboard.press('Shift+D');
  await expect(status).toContainText(/Tool:\s*Shape/i);
  await page.keyboard.press('Escape');
  await expect(status).toContainText(/Tool:\s*Select and pan/i);
  for (const [shortcut, tool] of [
    ['r', 'Redaction mark'],
    ['f', 'Form field'],
  ] as const) {
    await page.keyboard.press(shortcut);
    await expect(status).toContainText(new RegExp(`Tool:\\s*${tool}`, 'i'));
    await page.keyboard.press('Escape');
    await expect(status).toContainText(/Tool:\s*Select and pan/i);
  }

  await page.keyboard.press('r');
  await capture(page, browserName, 'active-redaction-tool.png');
  const panel = page.getByRole('region', { name: 'Markup tools' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Tool properties' }).click();
  await panel.getByRole('combobox', { name: 'Line style' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Redaction mark' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(status).toContainText(/Tool:\s*Select and pan/i);
});

test('keeps triggerable notices actionable and password dialogs modal', async ({
  page,
  browserName,
}) => {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'not-a-pdf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a PDF'),
  });
  const alert = page.getByRole('alert').last();
  await expect(alert).toBeVisible();
  const noticeBoxes = await page
    .locator('.notice-stack > [role="alert"], .notice-stack > [role="status"]')
    .evaluateAll((entries) =>
      entries.map((entry) => {
        const box = entry.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
  expect(noticeBoxes.length).toBeGreaterThan(0);
  const controlHeight = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--control-height'),
    ),
  );
  for (const box of noticeBoxes) {
    expect(box.right - box.left).toBeGreaterThanOrEqual(240);
  }
  for (let index = 0; index < noticeBoxes.length; index += 1) {
    for (let other = index + 1; other < noticeBoxes.length; other += 1) {
      const a = noticeBoxes[index]!;
      const b = noticeBoxes[other]!;
      expect(
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
      ).toBe(true);
    }
  }
  const dismiss = alert.getByRole('button', { name: 'Dismiss' });
  await capture(page, browserName, 'error-notice.png');
  await expect(dismiss).toBeVisible();
  expect((await dismiss.boundingBox())?.height).toBeGreaterThanOrEqual(controlHeight);
  await dismiss.click();
  await expect(alert).toBeHidden();

  const open = page.getByLabel('Open PDF');
  const openButton = page.getByRole('button', { name: 'Open document' });
  await openButton.focus();
  await open.setInputFiles(encryptedFixture);
  await expectFocusTrap(page, 'Unlock PDF');
  await capture(page, browserName, 'password-dialog.png');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Unlock PDF' })).toBeHidden();
  await expect(openButton).toBeFocused();
});

test('traps and restores focus for the unsaved-change dialog', async ({
  page,
  browserName,
}) => {
  await openFixture(page);
  const markup = page.getByRole('button', { name: 'Markup', exact: true });
  await markup.click();
  await page
    .getByRole('region', { name: 'Markup tools' })
    .getByRole('button', { name: 'Sticky note' })
    .click();
  await expect(page.getByRole('button', { name: 'Undo document change' })).toBeEnabled();

  const openButton = page.getByRole('button', { name: 'Open document' });
  await openButton.focus();
  await page.getByLabel('Open PDF').setInputFiles(secondFixture);
  await expectFocusTrap(page, 'Save changes before opening another PDF?');
  await capture(page, browserName, 'unsaved-changes-dialog.png');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Save changes before opening another PDF?' }),
  ).toBeHidden();
  await expect(openButton).toBeFocused();
});

test('honours ADR 0016 tokens, motion, focus, themes, and narrow zoomed layouts', async ({
  page,
  browserName,
}) => {
  await page.goto('/pdf/app/');
  const expected = {
    compact: ['32px', '26px', '48px'],
    comfortable: ['40px', '32px', '56px'],
    touch: ['48px', '44px', '64px'],
  } as const;

  for (const theme of ['light', 'dark']) {
    const shell = page.locator('.editor-shell');
    const currentTheme = await shell.getAttribute('data-theme');
    if (currentTheme !== theme) {
      await page
        .getByRole('button', {
          name: theme === 'dark' ? 'Use dark theme' : 'Use light theme',
        })
        .click();
    }
    await expect(shell).toHaveAttribute('data-theme', theme);
    for (const [foreground, background, minimum] of [
      ['--text-primary', '--surface-chrome', 4.5],
      ['--text-secondary', '--surface-chrome', 4.5],
      ['--accent-text', '--accent-surface', 4.5],
      ['--text-on-accent', '--accent-fill', 4.5],
      ['--danger-text', '--danger-surface', 4.5],
      ['--warning-text', '--warning-surface', 4.5],
      ['--success-text', '--success-surface', 4.5],
      ['--info-text', '--info-surface', 4.5],
      ['--border-subtle', '--surface-chrome', 3],
      ['--border-subtle', '--surface-raised', 3],
      ['--border-strong', '--surface-chrome', 3],
      ['--focus-ring', '--surface-chrome', 3],
    ] as const) {
      expect(
        await resolvedContrast(page, foreground, background),
        `${theme} ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
    for (const [density, tokens] of Object.entries(expected)) {
      await page.evaluate(
        ({ density: nextDensity }) => {
          document.documentElement.dataset.density = nextDensity;
        },
        { density },
      );
      expect(
        await page.evaluate(() => {
          const shell = document.querySelector('.editor-shell');
          if (!shell) throw new Error('editor shell did not mount');
          const style = getComputedStyle(shell);
          const paperProbe = document.createElement('span');
          paperProbe.style.backgroundColor = 'var(--page-paper)';
          shell.append(paperProbe);
          const paper = getComputedStyle(paperProbe).backgroundColor;
          paperProbe.remove();
          return [
            style.getPropertyValue('--row-height').trim(),
            style.getPropertyValue('--control-height').trim(),
            style.getPropertyValue('--rail-width').trim(),
            paper,
          ];
        }),
      ).toEqual([...tokens, 'rgb(255, 255, 255)']);
      await expect(page.getByRole('banner', { name: 'Global toolbar' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
      const commandBox = await page.getByRole('button', { name: 'Commands' }).boundingBox();
      expect(Math.round((commandBox?.height ?? 0) * 100) / 100).toBeGreaterThanOrEqual(
        Number.parseFloat(tokens[1]),
      );
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('*')].every(
        (element) => getComputedStyle(element).transitionDuration === '0s',
      ),
    ),
  ).toBe(true);
  const command = page.getByRole('button', { name: 'Commands' });
  await command.focus();
  expect(
    await command.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).outlineWidth),
    ),
  ).toBeGreaterThanOrEqual(2);
  await capture(page, browserName, 'forced-colors-focus.png');

  for (const width of [380, 320]) {
    await page.setViewportSize({ width, height: 720 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole('combobox', { name: 'Interface density' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open document' })).toContainText('Open');
    const overflow = page.getByRole('button', { name: 'More editor actions' });
    await expect(overflow).toBeVisible();
    await overflow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Commands' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('keeps every narrow-shell control inside the viewport and every tool reachable', async ({
  page,
  browserName,
}) => {
  await openFixture(page);
  await page.setViewportSize({ width: 380, height: 780 });

  for (const region of [
    page.getByRole('banner', { name: 'Global toolbar' }),
    page.getByRole('navigation', { name: 'Tools' }),
    page.getByRole('contentinfo', { name: 'Document status' }),
  ]) {
    const boxes = await region
      .locator('button, [role="combobox"], input:not([hidden])')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
              left: rect.left,
              right: rect.right,
              width: rect.width,
            };
          }),
      );
    for (const box of boxes) {
      expect(box.left, `${box.name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.name} ends inside the viewport`).toBeLessThanOrEqual(380);
      expect(box.width, `${box.name} has a rendered width`).toBeGreaterThan(0);
    }
  }

  const rail = page.getByRole('navigation', { name: 'Tools' });
  for (const label of panelSurfaces) {
    const button = rail.getByRole('button', { name: label, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 381) + (box?.width ?? 0)).toBeLessThanOrEqual(380);
    const labelBox = await button.locator('span').boundingBox();
    expect(labelBox?.x ?? -1).toBeGreaterThanOrEqual(box?.x ?? 0);
    expect((labelBox?.x ?? 381) + (labelBox?.width ?? 0)).toBeLessThanOrEqual(
      (box?.x ?? 0) + (box?.width ?? 0),
    );
    expect(labelBox?.y ?? -1).toBeGreaterThanOrEqual(box?.y ?? 0);
    expect((labelBox?.y ?? 781) + (labelBox?.height ?? 0)).toBeLessThanOrEqual(780);
  }
  await capture(page, browserName, 'narrow-shell.png');
});

test('keeps empty-shell tools operable and explains their document prerequisite', async ({
  page,
}) => {
  await page.goto('/pdf/app/');
  const rail = page.getByRole('navigation', { name: 'Tools' });
  for (const label of panelSurfaces) {
    await expect(rail.getByRole('button', { name: label, exact: true })).toBeEnabled();
  }
  await rail.getByRole('button', { name: 'Forms', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Open a PDF to use Forms.');
  await page.keyboard.press('m');
  await expect(page.getByRole('status')).toContainText('Open a PDF to use document tools.');
  await expect(page.locator('.panel-frame')).toHaveCount(0);
  await expect(page.getByRole('contentinfo', { name: 'Document status' })).toContainText(
    /Tool:\s*Select and pan/i,
  );
  await rail.getByRole('button', { name: 'Scope', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Open contextual panels' }),
  ).toBeVisible();
});

test('uses designed controls with density-aware target sizes on every panel', async ({
  page,
  browserName,
}) => {
  await openFixture(page);
  for (const density of ['compact', 'comfortable', 'touch'] as const) {
    await page.getByRole('combobox', { name: 'Interface density' }).click();
    await page.getByRole('option', { name: new RegExp(density, 'i') }).click();
    const minimum = density === 'touch' ? 44 : 24;
    for (const label of panelSurfaces) {
      const trigger = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', {
        name: label,
        exact: true,
      });
      if ((await trigger.getAttribute('aria-pressed')) !== 'true') await trigger.click();
      const frame = page
        .locator('.panel-frame')
        .filter({ has: page.locator('.panel-chrome strong', { hasText: label }) })
        .last();
      await expect(frame).toBeVisible();
      expect(
        await frame
          .locator(
            'select:not([aria-hidden="true"]), details, input[type="color"], input[type="range"], input[type="checkbox"]',
          )
          .count(),
        `${label} has no visible native replacement controls`,
      ).toBe(0);
      const unexplainedDisabled = await frame
        .locator('button:disabled, input:disabled, [aria-disabled="true"]')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const style = getComputedStyle(element);
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.getClientRects().length > 0
              );
            })
            .map((element) => {
              const descriptions = (element.getAttribute('aria-describedby') ?? '')
                .split(/\s+/)
                .filter(Boolean)
                .map((id) => document.getElementById(id))
                .filter((description): description is HTMLElement => description !== null);
              const visible = descriptions.some((description) => {
                const style = getComputedStyle(description);
                return (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  description.getClientRects().length > 0
                );
              });
              return visible
                ? null
                : element.getAttribute('aria-label') ||
                    element.textContent?.trim() ||
                    element.tagName;
            })
            .filter((name): name is string => Boolean(name)),
        );
      expect(unexplainedDisabled, `${label} disabled-control explanations`).toEqual([]);
      const undersized = await frame
        .locator(
          'button:not(.panel-resize-handle), input:not([type="file"]), [role="combobox"], [role="checkbox"], [role="slider"]',
        )
        .evaluateAll(
          (elements, target) =>
            elements
              .filter((element) => {
                const style = getComputedStyle(element);
                return (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  element.getClientRects().length > 0
                );
              })
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
                  width: rect.width,
                  height: rect.height,
                };
              })
              .filter(({ width, height }) => width < target || height < target),
          minimum,
        );
      expect(undersized, `${label} ${density} target sizes`).toEqual([]);
      await trigger.click();
    }
    const shellUndersized = await page
      .locator(
        '.global-bar button, .global-bar [role="combobox"], .status-bar button, .tool-rail button',
      )
      .evaluateAll(
        (elements, target) =>
          elements
            .filter((element) => {
              const style = getComputedStyle(element);
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.getClientRects().length > 0
              );
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
                width: rect.width,
                height: rect.height,
              };
            })
            .filter(({ width, height }) => width < target || height < target),
        minimum,
      );
    expect(shellUndersized, `shell ${density} target sizes`).toEqual([]);
  }

  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: 'Markup', exact: true })
    .click();
  const markup = page.getByRole('region', { name: 'Markup tools' });
  await markup.getByRole('button', { name: 'Tool properties' }).click();
  await markup.getByRole('combobox', { name: 'Line style' }).click();
  const option = page.getByRole('option', { name: 'Dashed' });
  const optionBox = await option.boundingBox();
  expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await option.click();
  await markup.getByRole('button', { name: /^Fill colour:/ }).click();
  const swatch = page.getByRole('button', { name: 'Use #3853d8' });
  const swatchBox = await swatch.boundingBox();
  expect(swatchBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(swatchBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await capture(page, browserName, 'designed-property-controls.png');
  await swatch.click();
  await page.keyboard.press('Escape');
  const opacity = markup.getByRole('slider', { name: 'Opacity' });
  const opacityBeforeDrag = await opacity.getAttribute('aria-valuenow');
  const sliderBox = await opacity.boundingBox();
  if (!sliderBox) throw new Error('Opacity slider was not rendered.');
  await page.mouse.move(
    sliderBox.x + sliderBox.width * 0.2,
    sliderBox.y + sliderBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sliderBox.x + sliderBox.width * 0.8,
    sliderBox.y + sliderBox.height / 2,
  );
  await page.mouse.up();
  await expect(opacity).toHaveAttribute('aria-valuetext', /%$/);
  expect(await opacity.getAttribute('aria-valuenow')).not.toBe(opacityBeforeDrag);
});

test('keeps contextual panels concurrent, resizable, collapsible, and persistent', async ({
  page,
  browserName,
}) => {
  await openFixture(page, 'panel-layout.pdf');
  for (const label of ['Markup', 'Forms']) {
    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: label, exact: true })
      .click();
  }
  await expect(page.locator('.panel-frame')).toHaveCount(3);
  const markupFrame = page
    .locator('.panel-frame')
    .filter({ has: page.locator('.panel-chrome strong', { hasText: 'Markup' }) });
  const before = await markupFrame.boundingBox();
  const handle = markupFrame.getByRole('separator', { name: 'Resize Markup panel' });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Markup resize handle was not rendered.');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 70, handleBox.y + 40);
  await page.mouse.up();
  expect((await markupFrame.boundingBox())?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
  const pointerWidth = (await markupFrame.boundingBox())?.width ?? 0;
  const separator = markupFrame.getByRole('separator', { name: 'Resize Markup panel' });
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await markupFrame.boundingBox())?.width ?? 0).toBeGreaterThan(pointerWidth);
  await capture(page, browserName, 'concurrent-panels.png');

  await markupFrame.getByRole('button', { name: 'Collapse Markup panel' }).click();
  await expect(markupFrame).toHaveAttribute('data-collapsed', 'true');
  await page.reload();
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'panel-layout.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(fixture),
  });
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();
  await expect(page.locator('.panel-frame')).toHaveCount(3);
  await expect(
    page
      .locator('.panel-frame')
      .filter({ has: page.locator('.panel-chrome strong', { hasText: 'Markup' }) }),
  ).toHaveAttribute('data-collapsed', 'true');

  await page.getByRole('region', { name: 'Document pages' }).focus();
  await page.keyboard.press('Control+f');
  const searchInput = page.getByRole('searchbox', { name: 'Find in document' });
  await expect(searchInput).toBeFocused();
  const markup = page.getByRole('button', { name: 'Markup', exact: true });
  await markup.click();
  await expect(markup).toBeFocused();
  await expect(searchInput).not.toBeFocused();

  const closeAll = page.getByRole('button', { name: 'Close contextual panels' });
  await closeAll.focus();
  await closeAll.click();
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeFocused();
  await expect(page.locator('.panel-frame')).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'panel-layout.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(fixture),
  });
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();
  await expect(page.locator('.panel-frame')).toHaveCount(0);
});

test('remaps tool shortcuts locally and selects text from the keyboard', async ({
  page,
  browserName,
}) => {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles({
    name: 'keyboard.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(multipageFixture),
  });
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();
  await page.getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('button', { name: 'Edit shortcuts' }).click();
  const markupShortcut = page.getByRole('textbox', {
    name: 'Shortcut for Select markup tool family',
  });
  await markupShortcut.fill('G');
  await page.keyboard.press('Enter');
  const drawingShortcut = page.getByRole('textbox', {
    name: 'Shortcut for Select drawing tool family',
  });
  await drawingShortcut.fill('G');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('already assigned');
  await capture(page, browserName, 'shortcut-editor.png');
  await page.getByRole('button', { name: 'Disable shortcut for Select and pan tool' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Shortcut for Select and pan tool' }),
  ).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Document pages' }).focus();
  await page.keyboard.press('g');
  await expect(page.getByRole('contentinfo', { name: 'Document status' })).toContainText(
    /Tool:\s*Note/i,
  );
  await page.keyboard.press('Escape');

  await page.getByRole('region', { name: 'Document pages' }).focus();
  const selectionStatus = page.getByLabel('Text selection status');
  for (let count = 0; count < 5; count += 1) await page.keyboard.press('ArrowRight');
  await expect(selectionStatus).toContainText('Text caret:');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(selectionStatus).toContainText('Selected text:');
  const arbitrarySelection = await selectionStatus.textContent();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(selectionStatus).not.toHaveText(arbitrarySelection ?? '');
  await page.keyboard.press('Control+Shift+End');
  await expect(selectionStatus).toContainText('Selected text:');
  await expect(page.getByRole('button', { name: 'Copy selected text' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Edit selected text' })).toBeDisabled();
  await expect(page.getByText('Editing a cross-page selection is unavailable.')).toBeVisible();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit selected text' })).toBeEnabled();
  expect(
    await page.locator('.pdf-highlight-tile').evaluateAll((canvases) =>
      canvases.some((canvas) => {
        const element = canvas as HTMLCanvasElement;
        const context = element.getContext('2d');
        if (!context || element.width === 0 || element.height === 0) return false;
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) return true;
        }
        return false;
      }),
    ),
    'selection quads painted non-transparent pixels to the canvas overlay',
  ).toBe(true);
  await capture(page, browserName, 'keyboard-selection-actions.png');
  await page.getByRole('button', { name: 'Edit selected text' }).click();
  const replacement = page.getByLabel('Replacement text');
  await replacement.fill('abcd');
  await expect(replacement).toBeFocused();
  const caretBeforeHome = await replacement.evaluate(
    (input) => (input as HTMLTextAreaElement).selectionStart,
  );
  await replacement.press('Home');
  const caretAfterHome = await replacement.evaluate(
    (input) => (input as HTMLTextAreaElement).selectionStart,
  );
  expect(caretAfterHome).toBeLessThan(caretBeforeHome);
  await replacement.press('ArrowRight');
  expect(
    await replacement.evaluate((input) => (input as HTMLTextAreaElement).selectionStart),
  ).toBe(caretAfterHome + 1);
  await expect(replacement).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#document-keyboard-help')).toContainText('Shift');
  expect(
    await page
      .locator('.pdf-page')
      .evaluateAll((pages) =>
        pages.some((pageElement) =>
          [...pageElement.querySelectorAll('*')].some(
            (element) => (element.textContent ?? '').trim().length > 0,
          ),
        ),
      ),
  ).toBe(false);

  await page.getByRole('combobox', { name: 'Interface density' }).click();
  await page.getByRole('option', { name: /touch/i }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  const actionBar = page.getByRole('toolbar', { name: 'Selection actions' });
  const actionBox = await actionBar.boundingBox();
  expect(actionBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((actionBox?.x ?? 321) + (actionBox?.width ?? 0)).toBeLessThanOrEqual(320);
});

test('opens the prepared document in a local print window', async ({ page, browserName }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const popupEvent = page.waitForEvent('popup');
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    const printOutputs: { readonly type: string; readonly size: number }[] = [];
    Object.defineProperty(window, '__papertrailPrintOutputs', {
      configurable: true,
      value: printOutputs,
    });
    URL.createObjectURL = (object) => {
      if (object instanceof Blob) printOutputs.push({ type: object.type, size: object.size });
      return original(object);
    };
  });
  const printButton = page
    .getByRole('region', { name: 'Print document' })
    .getByRole('button', { name: 'Open print dialog' });
  await capture(page, browserName, 'print-preparation.png');
  await printButton.click();
  const popup = await popupEvent;
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __papertrailPrintOutputs?: readonly {
                readonly type: string;
                readonly size: number;
              }[];
            }
          ).__papertrailPrintOutputs,
      ),
    )
    .toEqual([expect.objectContaining({ type: 'application/pdf', size: expect.any(Number) })]);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __papertrailPrintOutputs?: readonly { readonly size: number }[];
          }
        ).__papertrailPrintOutputs?.[0]?.size ?? 0,
    ),
  ).toBeGreaterThan(1_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await popup.close();
});

test('validates every reachable file-producing UI path with independent readers', async ({
  page,
}) => {
  await page.goto('/pdf/app/');
  await page.getByLabel('Open PDF').setInputFiles(multipageFixture);
  await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();

  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await expectValidPdf(await saved);

  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  const organize = page.getByRole('region', { name: 'Organize pages' });
  await organize.getByRole('checkbox', { name: /Select page 1/i }).click();
  await organize.getByRole('button', { name: 'Extract selected' }).click();
  const extracted = page.waitForEvent('download');
  await organize.getByRole('button', { name: 'Apply change' }).click();
  await expectValidPdf(await extracted);

  await organize.getByRole('button', { name: 'Split in half' }).click();
  const splitDownloads: Download[] = [];
  page.on('download', (download) => splitDownloads.push(download));
  await organize.getByRole('button', { name: 'Apply change' }).click();
  await expect
    .poll(() => splitDownloads.length, { message: 'two split PDFs were downloaded' })
    .toBe(2);
  for (const download of splitDownloads) await expectValidPdf(download);

  await page.getByRole('button', { name: 'Protect', exact: true }).click();
  const protect = page.getByRole('region', { name: 'Security and redaction' });
  await protect.getByLabel('Open password').fill('reader-secret');
  await protect.getByLabel('Permissions password').fill('owner-secret');
  const protectedDownload = page.waitForEvent('download');
  await protect.getByRole('button', { name: 'Create encrypted copy' }).click();
  await expectValidPdf(await protectedDownload, 'reader-secret');

  const sanitizedDownload = page.waitForEvent('download');
  const confirmSanitize = protect.getByRole('checkbox', {
    name: /sanitizing permanently removes/,
  });
  await expect(
    protect.getByRole('button', { name: 'Sanitize document and download' }),
  ).toBeDisabled();
  await confirmSanitize.click();
  await protect.getByRole('button', { name: 'Sanitize document and download' }).click();
  await expectValidPdf(await sanitizedDownload);

  await page.getByRole('button', { name: 'Markup', exact: true }).click();
  const markup = page.getByRole('region', { name: 'Markup tools' });
  await markup.getByRole('button', { name: 'Tool properties' }).click();
  await markup.getByLabel('Tool set name').fill('Acceptance set');
  await markup.getByRole('button', { name: 'Save named set' }).click();
  const toolSetDownload = page.waitForEvent('download');
  await markup.getByRole('button', { name: 'Export sets' }).click();
  const toolSetPath = await (await toolSetDownload).path();
  if (!toolSetPath) throw new Error('Tool-set export has no local path.');
  expect(JSON.parse(readFileSync(toolSetPath, 'utf8'))).toMatchObject({
    version: 1,
    presets: [{ name: 'Acceptance set' }],
  });

  await page.getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('button', { name: 'Edit shortcuts' }).click();
  const shortcutDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const shortcutPath = await (await shortcutDownload).path();
  if (!shortcutPath) throw new Error('Shortcut export has no local path.');
  expect(JSON.parse(readFileSync(shortcutPath, 'utf8'))).toMatchObject({
    version: 1,
    shortcuts: {},
  });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  const comments = page.getByRole('region', { name: 'Comments table' });
  await comments.getByRole('button', { name: 'Preview export' }).click();
  const commentDownload = page.waitForEvent('download');
  await comments.getByRole('button', { name: 'Download XFDF' }).click();
  const commentPath = await (await commentDownload).path();
  if (!commentPath) throw new Error('Comment export has no local path.');
  expect(
    await page.evaluate(
      (xml) => {
        const documentNode = new DOMParser().parseFromString(xml, 'application/xml');
        return {
          root: documentNode.documentElement.localName,
          hasAnnotations: Boolean(documentNode.querySelector('annots')),
          parserError: Boolean(documentNode.querySelector('parsererror')),
        };
      },
      readFileSync(commentPath, 'utf8'),
    ),
  ).toEqual({ root: 'xfdf', hasAnnotations: true, parserError: false });

  await page.getByRole('button', { name: 'Forms', exact: true }).click();
  const forms = page.getByRole('region', { name: 'Prepare form' });
  await forms.getByLabel('Unique name').fill('acceptance-field');
  await forms.getByRole('button', { name: 'Create field' }).click();
  await expect(
    forms.getByRole('button', { name: 'acceptance-field', exact: true }),
  ).toBeVisible();
  const formDownload = page.waitForEvent('download');
  await forms.getByRole('button', { name: 'Export XFDF' }).click();
  const formResult = await formDownload;
  expect(formResult.suggestedFilename()).toMatch(/\.xfdf$/);
  const formPath = await formResult.path();
  if (!formPath) throw new Error('Form-data export has no local path.');
  expect(
    await page.evaluate(
      (xml) => {
        const documentNode = new DOMParser().parseFromString(xml, 'application/xml');
        return {
          root: documentNode.documentElement.localName,
          fields: [...documentNode.querySelectorAll('field')].map((field) =>
            field.getAttribute('name'),
          ),
          parserError: Boolean(documentNode.querySelector('parsererror')),
        };
      },
      readFileSync(formPath, 'utf8'),
    ),
  ).toEqual({ root: 'xfdf', fields: ['acceptance-field'], parserError: false });

  await page.getByRole('button', { name: 'Automate', exact: true }).click();
  const automation = page.getByRole('region', { name: 'Automation pipeline builder' });
  await automation.getByRole('button', { name: 'Add step' }).click();
  const pipelineDownload = page.waitForEvent('download');
  await automation.getByRole('button', { name: 'Export pipeline' }).click();
  const pipelinePath = await (await pipelineDownload).path();
  if (!pipelinePath) throw new Error('Pipeline export has no local path.');
  expect(JSON.parse(readFileSync(pipelinePath, 'utf8'))).toMatchObject({
    version: 1,
    name: 'Local document output',
    steps: [{ commandId: 'save' }],
  });

  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const convert = page.getByRole('region', { name: 'Convert and validate' });
  const markdownDownload = page.waitForEvent('download');
  await convert.getByRole('button', { name: 'Download Markdown' }).click();
  const markdownResult = await markdownDownload;
  expect(markdownResult.suggestedFilename()).toMatch(/\.md$/);
  const markdownPath = await markdownResult.path();
  if (!markdownPath) throw new Error('Markdown export has no local path.');
  const markdown = readFileSync(markdownPath, 'utf8');
  expect(markdown).toMatch(/^# .+\n\n## Page /);
  expect(markdown.split('\n').filter((line) => line.startsWith('## Page '))).toHaveLength(9);
});

test('drives the public landing surface at wide and narrow viewports', async ({
  page,
  browserName,
}) => {
  for (const [viewport, size] of [
    ['wide', { width: 1440, height: 900 }],
    ['narrow', { width: 380, height: 780 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto('/pdf/');
    await expect(
      page.getByRole('heading', { name: 'Edit PDFs without uploading them.' }),
    ).toBeVisible();
    await expect(page.getByText('Document-upload endpoints')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (browserName === 'chromium') {
      await page.screenshot({ path: join(screenshotDirectory, `landing-${viewport}.png`) });
    }
  }
});

for (const density of ['compact', 'comfortable', 'touch'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`drives the complete ${density} ${theme} surface matrix`, async ({
      page,
      browserName,
    }) => {
      await page.goto('/pdf/app/');
      await page.getByRole('combobox', { name: 'Interface density' }).click();
      await page.getByRole('option', { name: new RegExp(density, 'i') }).click();
      const shell = page.locator('.editor-shell');
      if ((await shell.getAttribute('data-theme')) !== theme) {
        await page
          .getByRole('button', {
            name: theme === 'dark' ? 'Use dark theme' : 'Use light theme',
          })
          .click();
      }

      for (const [viewport, size] of [
        ['wide', { width: 1440, height: 900 }],
        ['narrow', { width: 380, height: 780 }],
      ] as const) {
        await page.setViewportSize(size);
        if (browserName === 'chromium') {
          await page.screenshot({
            path: join(screenshotDirectory, `empty-${density}-${theme}-${viewport}.png`),
          });
        }
      }
      await page.getByLabel('Open PDF').setInputFiles({
        name: `surface-${density}-${theme}.pdf`,
        mimeType: 'application/pdf',
        buffer: readFileSync(fixture),
      });
      await expect(page.locator('canvas.pdf-tile').first()).toBeVisible();

      for (const [viewport, size] of [
        ['wide', { width: 1440, height: 900 }],
        ['narrow', { width: 380, height: 780 }],
      ] as const) {
        await page.setViewportSize(size);
        for (const label of panelSurfaces) {
          const nav = page.getByRole('navigation', { name: 'Tools' });
          const open = nav.locator('button[aria-pressed="true"]');
          while ((await open.count()) > 0) await open.first().click();
          await nav.getByRole('button', { name: label, exact: true }).click();
          await expect(page.locator('.panel-frame')).toHaveCount(1);
          await expect(page.locator('.panel-frame .context-panel')).toBeVisible();
          if (browserName === 'chromium') {
            await page.screenshot({
              path: join(
                screenshotDirectory,
                `${label.toLocaleLowerCase()}-${density}-${theme}-${viewport}.png`,
              ),
            });
          }
        }
      }
    });
  }
}
