#!/usr/bin/env node
// Builds the forked MuPDF WASM engine.
//
// The fork exists because MuPDF's C API already contains everything the hard features
// need — a complete content-stream processor vtable, marked-content access, and a
// pluggable signer — but its 2,944-line WASM shim exports none of it. See
// docs/adr/0004-fork-the-mupdf-wasm-build.md.
//
// The BUILT artifacts are committed (see .gitignore) so Vercel can build without a
// native toolchain. check-wasm-fresh.mjs proves they still match the source.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'vendor', 'mupdf-wasm', 'src');
const distDir = join(root, 'vendor', 'mupdf-wasm', 'dist');

if (!existsSync(srcDir)) {
  // Not an error. The vendored source is fetched on demand and is gitignored; a
  // fresh clone builds from the committed artifacts alone. Only CI, which runs
  // check:wasm:fresh, needs the source tree.
  if (existsSync(distDir)) {
    console.log('[build-wasm] Using committed artifacts; vendored MuPDF source not present.');
    process.exit(0);
  }
  console.log('[build-wasm] MuPDF not vendored yet and no artifacts present — skipping.');
  console.log('[build-wasm] Run scripts/vendor-mupdf.mjs to fetch and patch the source.');
  process.exit(0);
}

console.error('[build-wasm] Emscripten build not implemented yet.');
process.exit(1);
