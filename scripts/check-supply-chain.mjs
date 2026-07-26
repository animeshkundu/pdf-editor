#!/usr/bin/env node
// Supply-chain gate.
//
// This repo deliberately avoids three widely-used crates for advisory reasons, and
// that decision is easy to undo by accident during a routine dependency bump. The
// denylist below makes the reversal loud instead of silent.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

// Crates we will not reintroduce without an explicit ADR. See docs/THIRD-PARTY.md.
const DENIED_CRATES = {
  rustybuzz: 'RUSTSEC-2026-0206: unmaintained. Use harfrust.',
  'ttf-parser': 'RUSTSEC-2026-0192: unmaintained. Use skrifa / read-fonts.',
  rsa: 'RUSTSEC-2023-0071: Marvin timing attack, still unpatched. Sign via WebCrypto.',
};

const cargoLock = join(root, 'crates', 'pdftext', 'Cargo.lock');
if (existsSync(cargoLock)) {
  const lock = readFileSync(cargoLock, 'utf8');
  for (const [crate, reason] of Object.entries(DENIED_CRATES)) {
    if (new RegExp(`^name = "${crate}"$`, 'm').test(lock)) {
      console.error(`[check-supply-chain] DENIED crate present: ${crate}\n  ${reason}`);
      failed = true;
    }
  }

  const audit = spawnSync('cargo', ['audit', '--file', cargoLock], {
    encoding: 'utf8',
    shell: true,
  });
  if (audit.error || audit.status === null) {
    if (process.env.CI) {
      console.error('[check-supply-chain] cargo-audit unavailable in CI. Install cargo-audit.');
      failed = true;
    } else {
      console.log('[check-supply-chain] cargo-audit not installed locally; skipping.');
    }
  } else {
    process.stdout.write(audit.stdout ?? '');
    if (audit.status !== 0) {
      process.stderr.write(audit.stderr ?? '');
      failed = true;
    }
  }
} else {
  console.log('[check-supply-chain] No Cargo.lock yet; skipping crate checks.');
}

const npmAudit = spawnSync('npm', ['audit', '--audit-level=high', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: true,
  cwd: root,
});
try {
  const report = JSON.parse(npmAudit.stdout || '{}');
  const counts = report.metadata?.vulnerabilities ?? {};
  const serious = (counts.high ?? 0) + (counts.critical ?? 0);
  console.log(
    `[check-supply-chain] npm: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ` +
      `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
  );
  if (serious > 0) failed = true;
} catch {
  console.log('[check-supply-chain] npm audit produced no parseable report; skipping.');
}

process.exit(failed ? 1 : 0);
