import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checker = join(root, 'scripts', 'check-wasm-fresh.mjs');
const processorPatch = join(
  root,
  'vendor',
  'mupdf-wasm',
  'patches',
  '0001-buffered-processor-and-filter-export.patch',
);
const processorSource = join(
  root,
  'vendor',
  'mupdf-wasm',
  'src',
  'platform',
  'wasm',
  'lib',
  'mupdf-js-processor.c',
);
const processorOverlay = join(
  root,
  'vendor',
  'mupdf-wasm',
  'patches',
  'files',
  'mupdf-js-processor.c',
);

function checkFreshness(...args: string[]) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
}

describe.sequential('committed WASM provenance', () => {
  it('rejects artifacts when a tracked engine patch no longer matches the manifest', () => {
    const original = readFileSync(processorPatch);

    try {
      writeFileSync(processorPatch, Buffer.concat([original, Buffer.from('\n')]));
      const result = checkFreshness('--manifest-only');

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain(
        'BUILD INPUT CHANGED: vendor/mupdf-wasm/patches/0001-buffered-processor-and-filter-export.patch',
      );
    } finally {
      writeFileSync(processorPatch, original);
    }
  });

  it('rejects a binary rebuilt from semantically changed C source', () => {
    const hasVendoredSource = existsSync(processorSource);
    const source = hasVendoredSource ? processorSource : processorOverlay;
    const original = readFileSync(source, 'utf8');
    const changed = original.replace(
      '#define WASM_PDF_TRACE_MAGIC 0x5052504aU',
      '#define WASM_PDF_TRACE_MAGIC 0x5052504bU',
    );
    expect(changed).not.toBe(original);

    try {
      writeFileSync(source, changed);
      const result = checkFreshness(...(hasVendoredSource ? [] : ['--manifest-only']));

      expect(result.status, result.stderr || result.stdout).toBe(1);
      if (hasVendoredSource) {
        expect(result.stderr).toContain(
          'SOURCE CHANGED since last build: vendor/mupdf-wasm/src/platform/wasm/lib/mupdf-js-processor.c',
        );
        expect(result.stderr).toContain(
          'REBUILT ARTIFACT MISMATCH: vendor/mupdf-wasm/dist/mupdf-wasm.wasm',
        );
      } else {
        expect(result.stderr).toContain(
          'BUILD INPUT CHANGED: vendor/mupdf-wasm/patches/files/mupdf-js-processor.c',
        );
      }
    } finally {
      writeFileSync(source, original);
    }
  }, 120_000);

  it('passes the real full-mode artifact and source freshness check', () => {
    const result = checkFreshness();

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('5 artifact(s) match the manifest');
    expect(result.stdout).toContain('8 tracked build input(s) match the manifest');
    expect(result.stdout).toContain(
      existsSync(processorSource)
        ? '5 rebuilt artifact(s) match committed output'
        : 'Vendored source absent; skipping source-digest check',
    );
  }, 120_000);
});
