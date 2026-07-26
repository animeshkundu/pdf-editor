#!/usr/bin/env node
// Builds the Rust font and text-shaping module to WebAssembly.
//
// wasm-pack is deliberately not used: it is archived, and it wraps three steps we would
// rather drive ourselves anyway. Those steps are cargo -> wasm-bindgen -> wasm-opt, and
// the ordering matters. wasm-bindgen rewrites the module to add its glue, so wasm-opt
// has to run AFTER it; optimising first then rewriting loses most of the size win.
//
// Like scripts/cargo.mjs this exits 0 when crates/pdftext/ does not exist yet, so it is
// safe to wire into a workflow before the crate lands.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = join(root, 'crates', 'pdftext');
const manifest = join(crateDir, 'Cargo.toml');
const outDir = join(root, 'vendor', 'pdftext-wasm', 'dist');
const TARGET = 'wasm32-unknown-unknown';

function log(message) {
  console.log(`[build-rust-wasm] ${message}`);
}

function fail(message) {
  console.error(`[build-rust-wasm] ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: root });
  if (result.status !== 0) fail(`\`${cmd}\` exited ${result.status ?? 'abnormally'}.`);
}

function have(cmd) {
  return spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: true }).status === 0;
}

if (!existsSync(manifest)) {
  log('crates/pdftext not created yet; skipping.');
  process.exit(0);
}

if (!have('cargo')) {
  // Local machines may not have Rust. CI always does, and CI is where this must bite.
  if (process.env.CI) fail('Rust toolchain missing in CI. Run the setup-rust action first.');
  log('Rust toolchain not found locally; skipping. CI will enforce this.');
  process.exit(0);
}

for (const tool of ['wasm-bindgen', 'wasm-opt']) {
  if (!have(tool)) fail(`${tool} not found. Run \`node scripts/setup-wasm-tools.mjs\` first.`);
}

// The compiled artifact is named after the crate with dashes folded to underscores, and
// reading it from the manifest is what keeps this working if the crate is ever renamed.
const crateName = readFileSync(manifest, 'utf8').match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
if (!crateName) fail(`Could not read the crate name from ${relative(root, manifest)}.`);
const libName = crateName.replace(/-/g, '_');

run('cargo', ['build', '--release', '--target', TARGET, '--manifest-path', manifest]);

const compiled = join(crateDir, 'target', TARGET, 'release', `${libName}.wasm`);
if (!existsSync(compiled)) {
  fail(
    `Expected ${relative(root, compiled)} after the build. ` +
      'The crate must be a `cdylib` for wasm-bindgen to have anything to rewrite.',
  );
}

mkdirSync(outDir, { recursive: true });

// `--target web` emits a plain ES module with no bundler assumptions, which is what the
// engine worker needs: it is instantiated from a Worker, not from the app bundle.
run('wasm-bindgen', [
  compiled,
  '--target',
  'web',
  '--out-dir',
  outDir,
  '--out-name',
  'pdftext',
  // Nothing reads the .d.ts from here; types are declared alongside the port in lib/.
  '--no-typescript',
]);

const rewritten = join(outDir, 'pdftext_bg.wasm');
if (!existsSync(rewritten)) fail(`wasm-bindgen did not produce ${relative(root, rewritten)}.`);

const before = statSync(rewritten).size;

// -Oz over -O3: this module is fetched before the first glyph can be shaped, so bytes on
// the wire cost more than a few microseconds of shaping throughput. The feature flags
// match what the Rust target emits by default on recent toolchains; without them
// wasm-opt refuses input it considers to use unenabled features.
run('wasm-opt', [
  '-Oz',
  '--enable-bulk-memory',
  '--enable-mutable-globals',
  '--enable-nontrapping-float-to-int',
  '--enable-sign-ext',
  '--enable-reference-types',
  '--strip-debug',
  '--strip-producers',
  rewritten,
  '-o',
  rewritten,
]);

const after = statSync(rewritten).size;
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
log(`wasm-opt: ${kb(before)} -> ${kb(after)} (${((1 - after / before) * 100).toFixed(1)}% smaller)`);

log(`Artifacts in ${relative(root, outDir).replace(/\\/g, '/')}:`);
for (const entry of readdirSync(outDir).sort()) {
  log(`  ${kb(statSync(join(outDir, entry)).size).padStart(10)}  ${entry}`);
}
