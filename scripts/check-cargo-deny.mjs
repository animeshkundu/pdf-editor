#!/usr/bin/env node
// cargo-deny gate: licenses, duplicate crates, and source provenance.
//
// This is NOT a duplicate of scripts/check-supply-chain.mjs. That script covers
// vulnerability advisories (cargo-audit, npm audit) and a hand-maintained denylist of
// three specific crates. cargo-deny answers three different questions that no advisory
// database can:
//
//   1. LICENSES. This project is AGPL-3.0-only. A transitively pulled-in crate under a
//      license AGPL cannot absorb makes the shipped binary undistributable, and nothing
//      else in the pipeline would notice until someone audited it by hand.
//   2. SOURCES. Every crate must come from crates.io. A dependency silently switched to
//      a git URL is a supply-chain change that no advisory feed covers, because the code
//      is not published anywhere to have an advisory filed against it.
//   3. DUPLICATES. Two semver-incompatible copies of the same crate in one wasm32
//      binary is dead weight in a module the user waits on before the first glyph
//      renders.
//
// Like every other Rust-facing script here, this exits 0 before crates/pdftext/ exists,
// and starts enforcing the moment it does.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'crates', 'pdftext', 'Cargo.toml');

// The policy lives beside this script rather than at the repository root, which is
// cargo-deny's usual location. That is a file-ownership constraint, not a preference:
// moving it to ./deny.toml is a one-line change here and is worth doing when the crate
// lands, since that is where a Rust developer will look for it first.
const config = join(root, 'scripts', 'deny.toml');

function log(message) {
  console.log(`[check-cargo-deny] ${message}`);
}

if (!existsSync(manifest)) {
  log('crates/pdftext not created yet; skipping.');
  process.exit(0);
}

const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true });
if (probe.status !== 0) {
  // Same contract as scripts/cargo.mjs: local machines may not have Rust, CI always
  // does, and CI is where this must bite.
  if (process.env.CI) {
    console.error(
      '[check-cargo-deny] Rust toolchain missing in CI. Install it before the gates.',
    );
    process.exit(1);
  }
  log('Rust toolchain not found locally; skipping. CI will enforce this.');
  process.exit(0);
}

const installed = spawnSync('cargo', ['deny', '--version'], { encoding: 'utf8', shell: true });
if (installed.status !== 0) {
  if (process.env.CI) {
    console.error(
      '[check-cargo-deny] cargo-deny unavailable in CI. Install it with ' +
        '`cargo install --locked cargo-deny`.',
    );
    process.exit(1);
  }
  log('cargo-deny not installed locally; skipping. CI will enforce this.');
  process.exit(0);
}

if (!existsSync(config)) {
  // Failing here rather than letting cargo-deny fall back to its built-in defaults. The
  // defaults permit license sets this project cannot ship, so a silent fallback would be
  // a gate that passes while proving nothing.
  console.error(
    `[check-cargo-deny] ${relative(root, config)} is missing. The license and source ` +
      'policy lives there; refusing to run against cargo-deny defaults.',
  );
  process.exit(1);
}

// `advisories` is deliberately excluded: cargo-audit already covers it in
// scripts/check-supply-chain.mjs, and running both would report every advisory twice.
const result = spawnSync(
  'cargo',
  [
    'deny',
    '--manifest-path',
    manifest,
    '--config',
    config,
    'check',
    'licenses',
    'bans',
    'sources',
  ],
  { stdio: 'inherit', shell: true },
);

process.exit(result.status ?? 1);
