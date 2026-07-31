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
const installLock = join(cacheRoot, `qpdf-${VERSION}.lock`);
const qpdf = join(installDir, 'bin', 'qpdf');
const PYTHON_EXTRACTOR = String.raw`
import os
import stat
import sys
import zipfile

archive, destination = sys.argv[1:3]
with zipfile.ZipFile(archive) as source:
    for entry in source.infolist():
        target = os.path.join(destination, entry.filename)
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode):
            os.makedirs(os.path.dirname(target), exist_ok=True)
            os.symlink(source.read(entry).decode("utf-8"), target)
        else:
            source.extract(entry, destination)
`;

function runVersion(binary) {
  return spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
}

function isReady() {
  if (!existsSync(qpdf)) return false;
  const version = runVersion(qpdf);
  return version.status === 0 && version.stdout.includes(`qpdf version ${VERSION}`);
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
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
  // Stage inside the cache root, not os.tmpdir(). On a machine where /tmp is a separate
  // filesystem the final renameSync fails with EXDEV, and rename is what makes the
  // install atomic, so copying instead would trade one bug for a worse one.
  const tempDir = mkdtempSync(join(cacheRoot, `qpdf-${VERSION}-staging-`));
  const archivePath = join(tempDir, 'qpdf.zip');
  const extractDir = join(tempDir, 'extract');
  try {
    mkdirSync(extractDir);
    writeFileSync(archivePath, archive);
    const unzip = spawnSync('python3', ['-c', PYTHON_EXTRACTOR, archivePath, extractDir], {
      encoding: 'utf8',
      shell: false,
    });
    if (unzip.error) {
      throw new Error(`failed to run unzip: ${unzip.error.message}`);
    }
    if (unzip.status !== 0) {
      throw new Error(
        `failed to extract qpdf: unzip exited ${unzip.status}: ` +
          `${unzip.stderr || unzip.stdout || '(no output)'}`,
      );
    }
    chmodSync(join(extractDir, 'bin', 'qpdf'), 0o755);
    rmSync(installDir, { recursive: true, force: true });
    renameSync(extractDir, installDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureInstalled() {
  if (isReady()) return;
  mkdirSync(cacheRoot, { recursive: true });
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      mkdirSync(installLock);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
      if (isReady()) return;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for another qpdf ${VERSION} installation`, {
          cause: error,
        });
      }
      wait(100);
    }
  }
  try {
    if (!isReady()) await install();
  } finally {
    rmSync(installLock, { recursive: true, force: true });
  }
}

await ensureInstalled();
const version = runVersion(qpdf);
if (version.status !== 0 || !version.stdout.includes(`qpdf version ${VERSION}`)) {
  throw new Error(`qpdf ${VERSION} verification failed: ${version.stderr || version.stdout}`);
}

if (process.argv.includes('--print-path')) {
  process.stdout.write(`${qpdf}\n`);
} else {
  console.log(`[setup-qpdf] qpdf ${VERSION} ready at ${qpdf}`);
}
