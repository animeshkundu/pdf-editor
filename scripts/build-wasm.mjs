#!/usr/bin/env node
// Builds the forked MuPDF WASM engine.
//
// The fork exists because MuPDF's C API already contains everything the hard features
// need, but its 2,944-line WASM shim exports none of it. See
// docs/adr/0004-fork-the-mupdf-wasm-build.md.
//
// Two ways to get an Emscripten toolchain, tried in order:
//
//   1. `emcc` on PATH. This is CI, where .github/actions/setup-emsdk installs it.
//   2. A container runtime (podman or docker) running the official emscripten/emsdk
//      image. This is a developer machine, where installing a C toolchain system-wide
//      is a bigger ask than pulling an image.
//
// Note that MuPDF's own tools/build.sh runs `emsdk install 4.0.8` and
// `emsdk activate 4.0.8` regardless of what the surrounding environment provides, so
// the emsdk version we supply affects build SPEED, not the bytes produced. That is why
// a from-source build reproduces the published artifact exactly.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor', 'mupdf-wasm');
const srcDir = join(vendorDir, 'src');
const distDir = join(vendorDir, 'dist');
const wasmSrcDir = join(srcDir, 'platform', 'wasm');
const patchDir = join(vendorDir, 'patches');
const verifyOnly = process.argv.includes('--verify-only');

// Dropping `mujs=no` from upstream's default is what enables AcroForm JavaScript. The
// exports already exist in the shim; the flag is all that gates them. Measured cost:
// 240,327 bytes, about 2.3 percent of the binary.
const FEATURES = 'brotli=no extract=no xps=no svg=no';

// `make` caches object files per build_suffix. Without a distinct suffix a variant
// build silently reuses the previous configuration's objects and emits a byte-identical
// binary, which reads exactly like "this flag changes nothing". It cost an hour once.
const SUFFIX = 'fork';

const ARTIFACTS = [
  'mupdf-wasm.wasm',
  'mupdf-wasm.js',
  'mupdf-wasm.d.ts',
  'mupdf.js',
  'mupdf.d.ts',
];
const TRACKED_INPUTS = [
  join(root, 'package.json'),
  join(root, 'package-lock.json'),
  join(root, 'scripts', 'build-wasm.mjs'),
  join(root, 'scripts', 'vendor-mupdf.mjs'),
  join(vendorDir, '.emscripten-version'),
  join(vendorDir, 'source-stamp.json'),
];

function have(cmd) {
  // No shell: passing args through a shell concatenates rather than escapes them.
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
  return probe.status === 0;
}

function findEmsdk() {
  const candidates = [
    process.env.EMSDK,
    '/opt/emsdk',
    join(homedir(), 'emsdk'),
    join(tmpdir(), 'emsdk'),
  ].filter(Boolean);
  return candidates.find(
    (candidate) =>
      existsSync(join(candidate, 'emsdk_env.sh')) &&
      existsSync(join(candidate, 'upstream', 'emscripten', 'emcc')),
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(srcDir)) {
  if (verifyOnly) {
    console.error('[build-wasm] Cannot verify artifacts without the vendored MuPDF source.');
    process.exit(1);
  }
  if (existsSync(distDir) && ARTIFACTS.every((a) => existsSync(join(distDir, a)))) {
    console.log('[build-wasm] Using committed artifacts; vendored source not present.');
    console.log('[build-wasm] Run `node scripts/vendor-mupdf.mjs` to build from source.');
    process.exit(0);
  }
  console.log('[build-wasm] MuPDF not vendored and no artifacts present; nothing to do.');
  console.log('[build-wasm] Run `node scripts/vendor-mupdf.mjs` first.');
  process.exit(0);
}

let result;
const emsdk = findEmsdk();
if (have('emcc') || emsdk) {
  console.log(
    emsdk
      ? `[build-wasm] Building with emsdk at ${emsdk}.`
      : '[build-wasm] Building with emcc from PATH.',
  );
  result = spawnSync('bash', ['tools/build.sh'], {
    cwd: wasmSrcDir,
    stdio: 'inherit',
    env: { ...process.env, ...(emsdk ? { EMSDK: emsdk } : {}), FEATURES, SUFFIX },
  });
} else {
  const runtime = have('podman') ? 'podman' : have('docker') ? 'docker' : null;
  if (!runtime) {
    // In CI this is a genuine failure: the workflow installs emsdk, so its absence
    // means the setup step did not do its job and a stale artifact would ship.
    if (process.env.CI) {
      console.error('[build-wasm] No Emscripten toolchain and no container runtime in CI.');
      console.error('[build-wasm] .github/actions/setup-emsdk should have provided emcc.');
      process.exit(1);
    }
    // Locally, refusing outright would block every unrelated task on a developer
    // machine that simply has no C toolchain. On Windows the container runtime often
    // lives inside WSL and is not on PATH here at all. Say so clearly and continue;
    // check-wasm-fresh.mjs still refuses to let a stale artifact reach a release.
    console.warn('[build-wasm] No Emscripten toolchain and no container runtime found.');
    console.warn('[build-wasm] Skipping the WASM build. Install emsdk, or podman/docker.');
    console.warn('[build-wasm] On Windows, a runtime inside WSL is not visible from here;');
    console.warn('[build-wasm] run this script from inside WSL to use it.');
    process.exit(0);
  }
  console.log(`[build-wasm] Building in a container via ${runtime}.`);
  result = spawnSync(
    runtime,
    [
      'run',
      '--rm',
      '-v',
      `${srcDir}:/src:Z`,
      '-w',
      '/src',
      '-e',
      `FEATURES=${FEATURES}`,
      '-e',
      `SUFFIX=${SUFFIX}`,
      'docker.io/emscripten/emsdk:4.0.8',
      'bash',
      '-lc',
      'cd platform/wasm && bash tools/build.sh',
    ],
    { stdio: 'inherit' },
  );
}

if (result.status !== 0) {
  console.error(`[build-wasm] Build failed with status ${result.status}.`);
  process.exit(1);
}

const builtDir = join(wasmSrcDir, 'dist');
const missing = ARTIFACTS.filter((a) => !existsSync(join(builtDir, a)));
if (missing.length > 0) {
  console.error(`[build-wasm] Build reported success but produced no ${missing.join(', ')}.`);
  process.exit(1);
}

if (verifyOnly) {
  let mismatches = 0;
  for (const artifact of ARTIFACTS) {
    const built = join(builtDir, artifact);
    const committed = join(distDir, artifact);
    const rel = relative(root, committed).replace(/\\/g, '/');
    if (!existsSync(committed)) {
      console.error(`[build-wasm] MISSING committed artifact: ${rel}`);
      mismatches++;
    } else if (sha256(built) !== sha256(committed)) {
      console.error(`[build-wasm] REBUILT ARTIFACT MISMATCH: ${rel}`);
      console.error(`  committed ${sha256(committed)}`);
      console.error(`  rebuilt   ${sha256(built)}`);
      mismatches++;
    }
  }
  if (mismatches > 0) process.exit(1);
  console.log(`[build-wasm] ${ARTIFACTS.length} rebuilt artifact(s) match committed output.`);
  process.exit(0);
}

mkdirSync(distDir, { recursive: true });
for (const artifact of ARTIFACTS) {
  copyFileSync(join(builtDir, artifact), join(distDir, artifact));
}

// The manifest is what lets Vercel build without a native toolchain and still be held
// to something. scripts/check-wasm-fresh.mjs verifies the committed binaries against
// these digests, and the source digests catch a patched shim that was never rebuilt.
const manifest = {
  builtAt: null, // deliberately absent: a timestamp would make the manifest churn.
  features: FEATURES,
  suffix: SUFFIX,
  emscripten: '4.0.8',
  upstream: JSON.parse(readFileSync(join(vendorDir, 'source-stamp.json'), 'utf8')).upstream,
  artifacts: Object.fromEntries(
    ARTIFACTS.map((a) => [
      relative(root, join(distDir, a)).replace(/\\/g, '/'),
      sha256(join(distDir, a)),
    ]),
  ),
  sources: Object.fromEntries(
    walk(join(wasmSrcDir, 'lib'))
      .concat(walk(join(wasmSrcDir, 'tools')))
      .map((f) => [relative(root, f).replace(/\\/g, '/'), sha256(f)]),
  ),
  inputs: Object.fromEntries(
    TRACKED_INPUTS.concat(walk(patchDir))
      .sort()
      .map((f) => [relative(root, f).replace(/\\/g, '/'), sha256(f)]),
  ),
};

writeFileSync(
  join(root, 'vendor', 'wasm-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log('[build-wasm] Artifacts:');
for (const artifact of ARTIFACTS) {
  const path = join(distDir, artifact);
  console.log(`  ${String(readFileSync(path).length).padStart(10)} B  ${artifact}`);
}
console.log(
  `[build-wasm] Wrote vendor/wasm-manifest.json (${Object.keys(manifest.sources).length} source digests).`,
);
