#!/usr/bin/env node
// Proves the committed WASM artifacts match the source they claim to come from.
//
// We commit build output for exactly one reason: Vercel's Git integration builds on
// runners that have neither Emscripten nor Rust, and we want to keep that integration
// rather than disable it. Committing binaries without a freshness proof would be an
// unverifiable claim, so every artifact carries a manifest recording the SHA-256 of
// its inputs, its toolchain versions, and its own digest.
//
//   --manifest-only : verify the artifacts match the manifest (fast; used by Vercel)
//   (default)       : also verify source, rebuild, and byte-compare without replacing
//                     the committed artifacts (CI)

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestOnly = process.argv.includes('--manifest-only');
const manifestPath = join(root, 'vendor', 'wasm-manifest.json');
const vendorDir = join(root, 'vendor', 'mupdf-wasm');
// package-lock.json is deliberately NOT tracked here. Both build paths in
// build-wasm.mjs shell out to `bash tools/build.sh` under emcc or the emscripten/emsdk
// container, so no npm dependency is read while producing the artifacts. Tracking the
// lockfile made every unrelated dependency bump invalidate WASM provenance and demand a
// full Emscripten rebuild, and because this gate runs first in CI a false positive here
// skips every downstream gate. package.json stays: it names the build entry point.
const trackedInputs = [
  join(root, 'package.json'),
  join(root, 'scripts', 'build-wasm.mjs'),
  join(root, 'scripts', 'vendor-mupdf.mjs'),
  join(vendorDir, '.emscripten-version'),
  join(vendorDir, 'source-stamp.json'),
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.isFile()) out.push(full);
  }
  return out.sort();
}

if (!existsSync(manifestPath)) {
  console.log('[check-wasm-fresh] No manifest yet; no WASM artifacts to verify. Skipping.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let failures = 0;

const currentInputPaths = new Set(
  trackedInputs
    .concat(walk(join(vendorDir, 'patches')))
    .map((file) => relative(root, file).replace(/\\/g, '/')),
);
for (const relPath of currentInputPaths) {
  if (!manifest.inputs?.[relPath]) {
    console.error(`[check-wasm-fresh] BUILD INPUT NOT IN MANIFEST: ${relPath}`);
    failures++;
  }
}
for (const relPath of Object.keys(manifest.inputs ?? {})) {
  if (!currentInputPaths.has(relPath)) {
    console.error(`[check-wasm-fresh] MANIFEST INPUT NO LONGER EXISTS: ${relPath}`);
    failures++;
  }
}

for (const [relPath, expected] of Object.entries(manifest.inputs ?? {})) {
  const full = join(root, relPath);
  if (!existsSync(full)) {
    console.error(`[check-wasm-fresh] MISSING build input: ${relPath}`);
    failures++;
    continue;
  }
  const actual = sha256(readFileSync(full));
  if (actual !== expected) {
    console.error(`[check-wasm-fresh] BUILD INPUT CHANGED: ${relPath}`);
    console.error(`  expected ${expected}`);
    console.error(`  actual   ${actual}`);
    failures++;
  }
}

for (const [relPath, expected] of Object.entries(manifest.artifacts ?? {})) {
  const full = join(root, relPath);
  if (!existsSync(full)) {
    console.error(`[check-wasm-fresh] MISSING artifact: ${relPath}`);
    failures++;
    continue;
  }
  const actual = sha256(readFileSync(full));
  if (actual !== expected) {
    console.error(`[check-wasm-fresh] DIGEST MISMATCH: ${relPath}`);
    console.error(`  expected ${expected}`);
    console.error(`  actual   ${actual}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(
    `\n[check-wasm-fresh] ${failures} artifact(s) do not match the manifest.\n` +
      'Rebuild with `npm run build:wasm` and commit both the artifacts and the manifest.',
  );
  process.exit(1);
}

console.log(
  `[check-wasm-fresh] ${Object.keys(manifest.artifacts ?? {}).length} artifact(s) match the manifest.`,
);
console.log(
  `[check-wasm-fresh] ${Object.keys(manifest.inputs ?? {}).length} tracked build input(s) match the manifest.`,
);

if (manifestOnly) process.exit(0);

// Full mode verifies source identity and digests before rebuilding the same source and
// comparing every generated artifact with committed output.
const srcDir = join(vendorDir, 'src');
if (!existsSync(srcDir)) {
  console.log('[check-wasm-fresh] Vendored source absent; skipping source-digest check.');
  process.exit(0);
}

const sourceRoots = [
  join(srcDir, 'platform', 'wasm', 'lib'),
  join(srcDir, 'platform', 'wasm', 'tools'),
];
const currentSources = sourceRoots.flatMap((dir) => walk(dir));
const currentSourcePaths = new Set(
  currentSources.map((file) => relative(root, file).replace(/\\/g, '/')),
);

const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: srcDir,
  encoding: 'utf8',
  shell: false,
});
if (head.status !== 0 || head.stdout.trim() !== manifest.upstream?.commit) {
  console.error('[check-wasm-fresh] vendored MuPDF commit does not match the manifest.');
  failures++;
}
const submodules = spawnSync('git', ['submodule', 'status', '--recursive'], {
  cwd: srcDir,
  encoding: 'utf8',
  shell: false,
});
if (
  submodules.status !== 0 ||
  sha256(Buffer.from(submodules.stdout)) !== manifest.upstream?.submodulesSha256
) {
  console.error('[check-wasm-fresh] vendored MuPDF submodules do not match the manifest.');
  failures++;
}
const sourceStatus = spawnSync('git', ['status', '--short', '--untracked-files=all'], {
  cwd: srcDir,
  encoding: 'utf8',
  shell: false,
});
const expectedSourceStatus = [
  ' M platform/wasm/lib/mupdf.c',
  ' M platform/wasm/lib/mupdf.ts',
  ' M platform/wasm/tools/build.sh',
  '?? platform/wasm/lib/mupdf-js-processor.c',
].sort();
if (
  sourceStatus.status !== 0 ||
  JSON.stringify(sourceStatus.stdout.split('\n').filter(Boolean).sort()) !==
    JSON.stringify(expectedSourceStatus)
) {
  console.error('[check-wasm-fresh] vendored source has changes outside the patch set.');
  failures++;
}

for (const file of currentSources) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const expected = manifest.sources?.[rel];
  if (!expected) {
    console.error(`[check-wasm-fresh] SOURCE NOT IN MANIFEST: ${rel}`);
    failures++;
  } else if (sha256(readFileSync(file)) !== expected) {
    console.error(`[check-wasm-fresh] SOURCE CHANGED since last build: ${rel}`);
    failures++;
  }
}

for (const rel of Object.keys(manifest.sources ?? {})) {
  if (!currentSourcePaths.has(rel)) {
    console.error(`[check-wasm-fresh] MANIFEST SOURCE MISSING: ${rel}`);
    failures++;
  }
}

if (failures === 0) {
  console.log(`[check-wasm-fresh] ${currentSources.length} source file(s) match the manifest.`);
}

const rebuild = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'build-wasm.mjs'), '--verify-only'],
  {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  },
);
process.stdout.write(rebuild.stdout ?? '');
process.stderr.write(rebuild.stderr ?? '');
if (rebuild.status !== 0) failures++;

process.exit(failures > 0 ? 1 : 0);
