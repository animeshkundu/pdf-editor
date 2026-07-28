#!/usr/bin/env node
// Fetches MuPDF's source at a pinned tag and applies our shim patches.
//
// WHY WE FORK
//
// MuPDF's C API already contains everything the hard features need. Its WASM shim
// does not export it. The shim (platform/wasm/lib/mupdf.c) is ~2,944 lines with ~335
// exports and a handful of macros that make adding one a two-line change, so forking
// it is far cheaper than the alternative: reimplementing a PDF content-stream
// interpreter, which no library in any language provides and which MuPDF has already
// tested against its own corpus.
//
// What the fork adds, and why each matters:
//
//   pdf_processor via a js_processor bridge
//     A complete vtable over every content-stream operator. op_Tf hands back a
//     RESOLVED pdf_font_desc rather than just a resource name, which answers "which
//     font produced this glyph"; otherwise unanswerable through the public API.
//     op_BDC hands back the cooked, resource-resolved property dictionary, which is
//     the MCID and unblocks tagged-PDF editing. op_BI hands back a decoded image, so
//     the inline-image EI-ambiguity problem never reaches us.
//
//   pdf_filter_page_contents + pdf_new_sanitize_filter
//     The sanitize filter repairs mismatched operators, preserves BMC/EMC nesting,
//     and normalises graphics state so synthesised operators behave predictably, with
//     a documented guarantee of identical net graphical effect.
//
//   FEATURES: mujs=no -> mujs=yes
//     A one-token change. The AcroForm JavaScript exports already exist in the shim
//     and simply begin working. There is no other path to that feature in any
//     language short of reimplementing PDF's JS object model.
//
//   a custom pdf_pkcs7_signer
//     A function-pointer vtable, not an OpenSSL type. Supplying our own, whose
//     create_digest calls into JS, lets MuPDF keep the genuinely bug-prone PDF-side
//     plumbing (ByteRange computation, placeholder sizing, incremental update) while
//     WebCrypto and PKI.js do the cryptography. This avoids building OpenSSL under
//     Emscripten entirely.
//
// This script only fetches and patches. scripts/build-wasm.mjs runs the build, which
// needs Emscripten and therefore a Linux environment.

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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor', 'mupdf-wasm');
const srcDir = join(vendorDir, 'src');
const patchDir = join(vendorDir, 'patches');
const overlayDir = join(patchDir, 'files');

// Pinned to the release matching the `mupdf` npm package in package.json. The JS
// bindings and the C sources must come from the same tag or the generated TypeScript
// declarations will not match the exports.
const MUPDF_TAG = '1.28.0';
const MUPDF_COMMIT = '205b8cf43551279d1215e88fe2845c5d595bade9';
const MUPDF_REPO = 'https://github.com/ArtifexSoftware/mupdf.git';
const EMSCRIPTEN_VERSION = '4.0.8';
const EXPECTED_PATCHED_FILES = new Map([
  [
    'platform/wasm/lib/mupdf.c',
    '2c0dc0aa47b70f2a6a89b48c2844ab49fc6afbee9f4781a1b560d873d64dba3f',
  ],
  [
    'platform/wasm/lib/mupdf.ts',
    '776e28f79fe3a01ca87556b7310bf0ac66c5fcac33efd0a89cc7f6eac2a92988',
  ],
  [
    'platform/wasm/lib/mupdf-js-processor.c',
    'bb354baf092bc1d2f611c535b8bd9f211dd89b32a061fa0d5628a520d8ea8840',
  ],
  [
    'platform/wasm/tools/build.sh',
    '362257917de7aeab3eb5a00ebb8322550b112f5f102535b81679933dd020351c',
  ],
  [
    'include/mupdf/pdf/javascript.h',
    '6afc5eae60d76d45d25f26ab995aef4a4717c3fe4305abc670d134b494c1ba0f',
  ],
  ['source/pdf/pdf-js.c', 'dc4ef4709537a719b604deec6cc896bad7bd65f2cf3ab5b63574be2db52cc6e2'],
  [
    'include/mupdf/pdf/object.h',
    '469d03e7bfc8a15d48b35622fed46ea1d284ad6b4bce7de427249db33d38ecff',
  ],
  [
    'source/pdf/pdf-parse.c',
    '05dcb42b0925afa1efae77c47a5a150354abc2ff28d185a9238a935c6a850745',
  ],
  ['source/pdf/pdf-form.c', '89130b86652e5e052b98870c6c4fe2e344ba7216d5db5b5025a214e58a20d573'],
]);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${r.status}`);
  }
}

function capture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

if (existsSync(join(srcDir, '.git'))) {
  console.log(`[vendor-mupdf] Source already present at ${srcDir}.`);
} else {
  mkdirSync(vendorDir, { recursive: true });
  console.log(`[vendor-mupdf] Cloning MuPDF ${MUPDF_TAG} (shallow, with submodules)...`);
  // MuPDF vendors its third-party dependencies as submodules (freetype, harfbuzz,
  // jbig2dec, lcms2, libjpeg, openjpeg, zlib). The WASM build needs all of them.
  run('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    MUPDF_TAG,
    '--recurse-submodules',
    '--shallow-submodules',
    MUPDF_REPO,
    srcDir,
  ]);
}

const remote = capture('git', ['remote', 'get-url', 'origin'], {
  cwd: srcDir,
}).trim();
const head = capture('git', ['rev-parse', 'HEAD'], { cwd: srcDir }).trim();
if (remote !== MUPDF_REPO || head !== MUPDF_COMMIT) {
  throw new Error(
    `vendored source identity mismatch: expected ${MUPDF_REPO}@${MUPDF_COMMIT}, ` +
      `got ${remote}@${head}`,
  );
}
const submoduleStatus = capture('git', ['submodule', 'status', '--recursive'], { cwd: srcDir });
if (
  submoduleStatus
    .split('\n')
    .filter(Boolean)
    .some((line) => line[0] !== ' ')
) {
  throw new Error('vendored MuPDF has uninitialized or modified submodules');
}

const shimPath = join(srcDir, 'platform', 'wasm', 'lib', 'mupdf.c');
if (!existsSync(shimPath)) {
  console.error(`[vendor-mupdf] Expected shim not found at ${shimPath}.`);
  console.error('[vendor-mupdf] MuPDF may have restructured; the patches need review.');
  process.exit(1);
}

const overlays = [
  {
    source: join(overlayDir, 'mupdf-js-processor.c'),
    target: join(srcDir, 'platform', 'wasm', 'lib', 'mupdf-js-processor.c'),
  },
];

for (const overlay of overlays) {
  if (!existsSync(overlay.source)) {
    console.error(`[vendor-mupdf] Missing overlay: ${overlay.source}`);
    process.exit(1);
  }
  mkdirSync(dirname(overlay.target), { recursive: true });
  copyFileSync(overlay.source, overlay.target);
  console.log(`[vendor-mupdf] Installed overlay: ${overlay.source}`);
}

if (!existsSync(patchDir)) {
  console.log('[vendor-mupdf] No patches directory yet; source fetched unmodified.');
  process.exit(0);
}

const patches = readdirSync(patchDir)
  .filter((f) => f.endsWith('.patch'))
  .sort();

if (patches.length === 0) {
  console.log('[vendor-mupdf] No patches to apply; source fetched unmodified.');
  process.exit(0);
}

for (const patch of patches) {
  const full = join(patchDir, patch);
  // Check first so a re-run is idempotent rather than failing on already-applied work.
  const already = spawnSync('git', ['apply', '--reverse', '--check', full], {
    cwd: srcDir,
    stdio: 'ignore',
  });
  if (already.status === 0) {
    console.log(`[vendor-mupdf] Already applied: ${patch}`);
    continue;
  }
  console.log(`[vendor-mupdf] Applying ${patch}`);
  run('git', ['apply', '--verbose', full], { cwd: srcDir });
}

for (const [path, expected] of EXPECTED_PATCHED_FILES) {
  const actual = sha256(readFileSync(join(srcDir, path)));
  if (actual !== expected) {
    throw new Error(`patched source mismatch for ${path}: expected ${expected}, got ${actual}`);
  }
}
const sourceStatus = capture('git', ['status', '--short', '--untracked-files=all'], {
  cwd: srcDir,
})
  .split('\n')
  .filter(Boolean)
  .sort();
const expectedStatus = [
  ' M include/mupdf/pdf/javascript.h',
  ' M include/mupdf/pdf/object.h',
  ' M platform/wasm/lib/mupdf.c',
  ' M platform/wasm/lib/mupdf.ts',
  ' M platform/wasm/tools/build.sh',
  ' M source/pdf/pdf-form.c',
  ' M source/pdf/pdf-js.c',
  ' M source/pdf/pdf-parse.c',
  '?? platform/wasm/lib/mupdf-js-processor.c',
].sort();
if (JSON.stringify(sourceStatus) !== JSON.stringify(expectedStatus)) {
  throw new Error(
    `vendored source contains changes outside the patch set:\n${sourceStatus.join('\n')}`,
  );
}

const shimLines = readFileSync(shimPath, 'utf8').split('\n').length;
console.log(`[vendor-mupdf] Patched shim is ${shimLines} lines.`);

// Record exactly what the artifacts will be built from, so check-wasm-fresh.mjs can
// prove the committed binaries correspond to this source and these patches.
const stamp = {
  tag: MUPDF_TAG,
  repo: MUPDF_REPO,
  upstream: {
    commit: MUPDF_COMMIT,
    submodulesSha256: sha256(submoduleStatus),
  },
  patches,
  overlays: overlays.map((overlay) => overlay.source.slice(root.length + 1)),
  shimLines,
};
writeFileSync(join(vendorDir, 'source-stamp.json'), `${JSON.stringify(stamp, null, 2)}\n`);
writeFileSync(join(vendorDir, '.emscripten-version'), `${EMSCRIPTEN_VERSION}\n`);
console.log('[vendor-mupdf] Wrote vendor/mupdf-wasm/source-stamp.json');
console.log('[vendor-mupdf] Wrote vendor/mupdf-wasm/.emscripten-version');
