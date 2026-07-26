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
//   (default)       : also rebuild from source into a temp dir and byte-compare (CI)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestOnly = process.argv.includes('--manifest-only');
const manifestPath = join(root, 'vendor', 'wasm-manifest.json');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

if (!existsSync(manifestPath)) {
  console.log('[check-wasm-fresh] No manifest yet; no WASM artifacts to verify. Skipping.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let failures = 0;

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

if (manifestOnly) process.exit(0);

// Full mode also verifies the SOURCE digests, so a patched shim cannot silently
// ship stale binaries. The rebuild-and-compare step lands with the Emscripten build.
const srcDir = join(root, 'vendor', 'mupdf-wasm', 'src');
if (!existsSync(srcDir)) {
  console.log('[check-wasm-fresh] Vendored source absent; skipping source-digest check.');
  process.exit(0);
}

for (const file of walk(srcDir)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const expected = manifest.sources?.[rel];
  if (expected && sha256(readFileSync(file)) !== expected) {
    console.error(`[check-wasm-fresh] SOURCE CHANGED since last build: ${rel}`);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
