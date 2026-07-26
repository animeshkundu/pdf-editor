#!/usr/bin/env node
// Installs the two host tools the Rust WASM build needs, idempotently.
//
// Neither belongs in the composite action: .github/actions/** is immutable to the
// autonomous build pipeline, and the wasm-bindgen version is not a constant. The CLI
// must match the `wasm-bindgen` crate EXACTLY, or the generated glue disagrees with the
// ABI the crate emitted and the module fails at instantiation with an error that looks
// nothing like a version mismatch. So the version is read from the lockfile at build
// time rather than pinned anywhere a human has to remember to update.
//
// wasm-opt comes from Binaryen. `cargo install wasm-opt` builds it from source and takes
// many minutes; the upstream release tarball is the same binary in seconds.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'crates', 'pdftext', 'Cargo.toml');

// Binaryen has no semver line to follow, so this is pinned. Bumping it is a deliberate
// act: wasm-opt's optimisation passes change output bytes, which changes the artifact
// digests that check-wasm-fresh.mjs compares.
const BINARYEN_VERSION = 'version_131';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: true, ...opts });

function log(message) {
  console.log(`[setup-wasm-tools] ${message}`);
}

function fail(message) {
  console.error(`[setup-wasm-tools] ${message}`);
  process.exit(1);
}

if (!existsSync(manifest)) {
  log('crates/pdftext not created yet; nothing to install.');
  process.exit(0);
}

if (run('cargo', ['--version']).status !== 0) {
  fail('Rust toolchain missing. Run the setup-rust action first.');
}

// --- wasm-bindgen-cli -------------------------------------------------------------

function wantedBindgenVersion() {
  const lock = join(root, 'crates', 'pdftext', 'Cargo.lock');
  if (existsSync(lock)) {
    // Cargo.lock is TOML; the package stanza is regular enough to read without a parser,
    // and adding a TOML dependency to a dependency-free script is the worse trade.
    const match = readFileSync(lock, 'utf8').match(
      /\[\[package\]\]\s*\nname = "wasm-bindgen"\nversion = "([^"]+)"/,
    );
    if (match) return match[1];
  }
  const toml = readFileSync(manifest, 'utf8');
  const match = toml.match(/^wasm-bindgen\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/m);
  return match ? (match[1] ?? match[2]) : null;
}

const bindgenVersion = wantedBindgenVersion();
if (!bindgenVersion) {
  log('crates/pdftext does not depend on wasm-bindgen; skipping the CLI.');
} else {
  const installed = run('wasm-bindgen', ['--version']).stdout?.trim().split(/\s+/)[1] ?? null;
  if (installed === bindgenVersion) {
    log(`wasm-bindgen-cli ${installed} already matches the crate.`);
  } else {
    log(
      `Installing wasm-bindgen-cli ${bindgenVersion}` +
        (installed ? ` (replacing ${installed})` : '') +
        ' to match the crate exactly.',
    );
    const install = run(
      'cargo',
      ['install', '--locked', '--force', 'wasm-bindgen-cli', '--version', bindgenVersion],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) fail(`cargo install wasm-bindgen-cli ${bindgenVersion} failed.`);
  }
}

// --- wasm-opt ---------------------------------------------------------------------

const optVersion = run('wasm-opt', ['--version']).stdout?.trim() ?? '';
if (optVersion) {
  log(`wasm-opt already present: ${optVersion}`);
  process.exit(0);
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  fail(
    `No wasm-opt on PATH, and this script only auto-installs the linux-x64 Binaryen ` +
      `release (running on ${process.platform}-${process.arch}). Install Binaryen manually.`,
  );
}

const asset = `binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz`;
const url = `https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/${asset}`;
const prefix = join(process.env.HOME ?? tmpdir(), '.local');
const staging = join(tmpdir(), `binaryen-${BINARYEN_VERSION}`);

log(`Downloading ${url}`);
mkdirSync(prefix, { recursive: true });
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const archive = join(staging, asset);
const download = run(
  'curl',
  ['--proto', "'=https'", '--tlsv1.2', '-fsSL', '--retry', '3', '-o', archive, url],
  {
    stdio: 'inherit',
  },
);
if (download.status !== 0) fail(`Failed to download ${url}`);

// --strip-components drops the versioned top-level directory so bin/ and lib/ land
// directly under the prefix, which is what putting ~/.local/bin on PATH expects.
const extract = run('tar', ['-xzf', archive, '-C', prefix, '--strip-components=1'], {
  stdio: 'inherit',
});
if (extract.status !== 0) fail('Failed to extract the Binaryen archive.');
rmSync(staging, { recursive: true, force: true });

const binDir = join(prefix, 'bin');
log(`Installed Binaryen ${BINARYEN_VERSION} to ${prefix}.`);

// GitHub Actions steps do not share a shell, so PATH has to be handed forward.
if (process.env.GITHUB_PATH) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_PATH, `${binDir}\n`);
  log(`Added ${binDir} to GITHUB_PATH.`);
} else {
  log(`Add ${binDir} to your PATH.`);
}
