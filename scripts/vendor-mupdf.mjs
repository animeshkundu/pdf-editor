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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor', 'mupdf-wasm');
const srcDir = join(vendorDir, 'src');
const patchDir = join(vendorDir, 'patches');

// Pinned to the release matching the `mupdf` npm package in package.json. The JS
// bindings and the C sources must come from the same tag or the generated TypeScript
// declarations will not match the exports.
const MUPDF_TAG = '1.28.0';
const MUPDF_REPO = 'https://github.com/ArtifexSoftware/mupdf.git';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${r.status}`);
  }
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

const shimPath = join(srcDir, 'platform', 'wasm', 'lib', 'mupdf.c');
if (!existsSync(shimPath)) {
  console.error(`[vendor-mupdf] Expected shim not found at ${shimPath}.`);
  console.error('[vendor-mupdf] MuPDF may have restructured; the patches need review.');
  process.exit(1);
}

const shimLines = readFileSync(shimPath, 'utf8').split('\n').length;
console.log(`[vendor-mupdf] Shim is ${shimLines} lines.`);

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

// Record exactly what the artifacts will be built from, so check-wasm-fresh.mjs can
// prove the committed binaries correspond to this source and these patches.
const stamp = {
  tag: MUPDF_TAG,
  repo: MUPDF_REPO,
  patches,
  shimLines,
};
writeFileSync(join(vendorDir, 'source-stamp.json'), `${JSON.stringify(stamp, null, 2)}\n`);
console.log('[vendor-mupdf] Wrote vendor/mupdf-wasm/source-stamp.json');
