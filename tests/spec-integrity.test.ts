import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checker = join(root, 'scripts', 'check-spec-integrity.mjs');
const inventory = join(root, 'docs', 'spec', 'parity-inventory.md');

function check(path: string) {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, PDF_EDITOR_INVENTORY_PATH: path },
  });
}

describe('parity inventory coverage summary', () => {
  it('fails when the authoritative summary count drifts from its own items', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pdf-editor-spec-'));
    const fixture = join(directory, 'parity-inventory.md');
    const original = readFileSync(inventory, 'utf8');
    const corrupted = original.replace('| `EXCLUDED` |    18 |', '| `EXCLUDED` |    19 |');
    expect(corrupted).not.toBe(original);

    try {
      writeFileSync(fixture, corrupted);
      const result = check(fixture);

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain(
        'coverage summary claims EXCLUDED = 19, but the inventory contains 18',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
