#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '12.3.2';
const ARCHIVE_SHA256 = '44f2c53bf784c0143128d80d2b9946e9793962c5bb403b75c0024cb4d8e346b9';
const ARCHIVE_URL =
  `https://github.com/qpdf/qpdf/releases/download/v${VERSION}/` +
  `qpdf-${VERSION}-bin-linux-x86_64.zip`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(root, 'node_modules', '.cache');
const installDir = join(cacheRoot, `qpdf-${VERSION}`);
const qpdf = join(installDir, 'bin', 'qpdf');

function runVersion(binary) {
  return spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
}

async function install() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(
      `qpdf ${VERSION} is pinned for linux-x64 CI; install that exact version on ` +
        `${process.platform}-${process.arch}`,
    );
  }

  const response = await fetch(ARCHIVE_URL);
  if (!response.ok) {
    throw new Error(`failed to download qpdf ${VERSION}: HTTP ${response.status}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== ARCHIVE_SHA256) {
    throw new Error(`qpdf archive digest mismatch: expected ${ARCHIVE_SHA256}, got ${digest}`);
  }

  mkdirSync(cacheRoot, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'pdf-editor-qpdf-'));
  const archivePath = join(tempDir, 'qpdf.zip');
  const extractDir = join(tempDir, 'extract');
  try {
    mkdirSync(extractDir);
    writeFileSync(archivePath, archive);
    const unzip = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], {
      encoding: 'utf8',
      shell: false,
    });
    if (unzip.status !== 0) {
      throw new Error(`failed to extract qpdf: ${unzip.stderr || unzip.stdout}`);
    }
    chmodSync(join(extractDir, 'bin', 'qpdf'), 0o755);
    rmSync(installDir, { recursive: true, force: true });
    renameSync(extractDir, installDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (!existsSync(qpdf)) {
  await install();
}

const version = runVersion(qpdf);
if (version.status !== 0 || !version.stdout.includes(`qpdf version ${VERSION}`)) {
  throw new Error(`qpdf ${VERSION} verification failed: ${version.stderr || version.stdout}`);
}

if (process.argv.includes('--print-path')) {
  process.stdout.write(`${qpdf}\n`);
} else {
  console.log(`[setup-qpdf] qpdf ${VERSION} ready at ${qpdf}`);
}
