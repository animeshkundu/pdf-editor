#!/usr/bin/env node
// Handle-ownership gate for the engine worker.
//
// MuPDF's WASM objects are manually memory-managed. All 27 Userdata classes need an
// explicit .destroy(), there is no FinalizationRegistry, and a leaked Pixmap leaks
// until the page reloads. Upstream calls this the most common production failure in
// mupdf.js, which is why it gets a blocking gate rather than a review convention.
//
// eslint.config.js already refuses a bare `new mupdf.X()` outside an arena. A purely
// syntactic rule cannot see the other half of the problem: METHOD calls that RETURN an
// owned object. `page.toPixmap(...)`, `page.toDisplayList(...)`,
// `page.toStructuredText(...)`, `doc.loadPage(...)` and friends allocate without a
// `new` at the call site, so nothing in the syntax marks them as owning.
//
// This walks lib/engine/worker/ and requires every call to a known handle-producing
// method to be either registered with an arena, retained under a key, or explicitly
// annotated as transferred to a caller that takes ownership.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(root, 'lib', 'engine', 'worker');

if (!existsSync(workerDir)) {
  console.log('[check-handles] lib/engine/worker/ does not exist yet; skipping.');
  process.exit(0);
}

// Methods that return an object the caller now owns and must eventually destroy.
const PRODUCERS = [
  'toPixmap',
  'toDisplayList',
  'toStructuredText',
  'loadPage',
  'loadOutline',
  'openDocument',
  'asPDF',
  'getObject',
  'newGraftMap',
  'toBuffer',
  'saveToBuffer',
  'readStream',
  'readRawStream',
  'createAnnotation',
  'newDictionary',
  'newArray',
  'addStream',
  'addObject',
  'outlineIterator',
  'toDisplayListDevice',
  'newDrawDevice',
];

// Wrappers that take ownership. A producer call whose result flows into one of these
// is accounted for.
const OWNERSHIP_SINKS = /\b(?:arena\s*\.\s*keep|retain|s\s*\.\s*keep|scope\s*\.\s*keep)\s*\(/;

// Explicit, greppable opt-out for the genuine case where a handle is returned to a
// caller that will own it. Requires a reason so it cannot become a habit.
const TRANSFER_MARK = /@transfers-ownership\b/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(workerDir);
if (files.length === 0) {
  console.log('[check-handles] No worker sources yet; skipping.');
  process.exit(0);
}

const producerCall = new RegExp(`\\.\\s*(${PRODUCERS.join('|')})\\s*\\(`, 'g');
const findings = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    for (const m of line.matchAll(producerCall)) {
      // The window covers a call split across lines by a formatter.
      const window = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join('\n');
      if (OWNERSHIP_SINKS.test(window)) continue;
      if (TRANSFER_MARK.test(window)) continue;

      findings.push({
        file: relative(root, file).replace(/\\/g, '/'),
        line: i + 1,
        method: m[1],
        text: line.trim(),
      });
    }
  }
}

if (findings.length > 0) {
  console.error('[check-handles] Unowned MuPDF handles:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  .${f.method}() result is not owned`);
    console.error(`    ${f.text}`);
  }
  console.error(
    '\nEvery handle-producing call must be registered with an arena, retained under a\n' +
      'key, or marked @transfers-ownership with a reason. There is no FinalizationRegistry\n' +
      'to catch what this misses; the leak lasts until the page reloads.',
  );
  process.exit(1);
}

console.log(
  `[check-handles] ${files.length} worker file(s) scanned; every handle-producing call is owned.`,
);
