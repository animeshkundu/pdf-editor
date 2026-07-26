#!/usr/bin/env node
// Runs a cargo subcommand against crates/, degrading cleanly when the Rust crate or
// toolchain is not present.
//
// `lint` and `test` are Factory pipeline gates detected by NAME, and a missing script
// silently removes the gate. So these must exist and exit 0 from the first commit,
// before crates/pdftext/ has been created, and start enforcing the moment it exists.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'crates', 'pdftext', 'Cargo.toml');
const args = process.argv.slice(2);

if (!existsSync(manifest)) {
  console.log(`[cargo] crates/pdftext not created yet; skipping \`cargo ${args[0] ?? ''}\`.`);
  process.exit(0);
}

const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true });
if (probe.status !== 0) {
  // Local machines may not have Rust. CI always does, and CI is where this must bite.
  if (process.env.CI) {
    console.error('[cargo] Rust toolchain missing in CI. Install it before running gates.');
    process.exit(1);
  }
  console.log('[cargo] Rust toolchain not found locally; skipping. CI will enforce this.');
  process.exit(0);
}

const result = spawnSync('cargo', [...args, '--manifest-path', manifest], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
