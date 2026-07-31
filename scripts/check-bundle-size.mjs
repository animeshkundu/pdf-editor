#!/usr/bin/env node
// Budgets the shipped bundle.
//
// The initial app bundle is budgeted SEPARATELY from lazily-loaded WASM. MuPDF alone
// is ~3.4 MB brotli; if it counted toward one combined ceiling it would dwarf the app
// code and a doubling of our own JavaScript would slip through unnoticed.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'dist';
const distDir = join(root, target);
const landingOnly = process.argv.includes('--landing');

const BUDGETS = {
  // Everything the browser must parse before the app shell can paint.
  initialJs: 260_000,
  initialCss: 60_000,
  // Fetched on demand: the engine chunk and the WASM binaries.
  lazyJs: 900_000,
  wasm: 4_500_000,
  totalUnpacked: 80_000_000,
};
const LANDING_BUDGETS = {
  compressed: 100_000,
  totalUnpacked: 500_000,
};

if (!existsSync(distDir)) {
  console.error(`[check-bundle-size] Build output not found at ${distDir}.`);
  process.exit(1);
}

function walk(dir, top = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (landingOnly && dir === top && entry === 'app') continue;
    if (statSync(full).isDirectory()) out.push(...walk(full, top));
    else out.push(full);
  }
  return out;
}

const brotli = (buf) =>
  brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

const files = walk(distDir);
if (files.length === 0) {
  console.error('[check-bundle-size] No output files. Refusing to pass vacuously.');
  process.exit(1);
}

if (landingOnly) {
  const totalUnpacked = files.reduce((total, file) => total + statSync(file).size, 0);
  const compressed = files.reduce((total, file) => total + brotli(readFileSync(file)), 0);
  const results = { compressed, totalUnpacked };
  let failed = false;
  console.log('[check-bundle-size] Landing page budgets (site/app excluded):');
  for (const [key, budget] of Object.entries(LANDING_BUDGETS)) {
    const actual = results[key];
    const ok = actual <= budget;
    if (!ok) failed = true;
    const pct = ((actual / budget) * 100).toFixed(0);
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(15)} ${kb(actual).padStart(12)} / ${kb(budget)} (${pct}%)`,
    );
  }
  if (failed) {
    console.error(
      '\n[check-bundle-size] Landing page is over budget. Raise the ceiling deliberately, with a reason.',
    );
    process.exit(1);
  }
  process.exit(0);
}

// Anything the entry HTML references with a plain <script> or <link> is "initial".
const html = files.filter((f) => f.endsWith('.html')).map((f) => readFileSync(f, 'utf8'));
const referenced = new Set();
for (const doc of html) {
  for (const m of doc.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (ref)
      referenced.add(
        ref
          .replace(/^\.?\//, '')
          .split('/')
          .pop(),
      );
  }
}

const buckets = { initialJs: 0, initialCss: 0, lazyJs: 0, wasm: 0 };
let totalUnpacked = 0;
const rows = [];

for (const file of files) {
  const buf = readFileSync(file);
  const name = file.split(/[\\/]/).pop();
  totalUnpacked += buf.length;

  let bucket = null;
  if (file.endsWith('.wasm')) bucket = 'wasm';
  else if (file.endsWith('.css')) bucket = referenced.has(name) ? 'initialCss' : 'lazyJs';
  else if (/\.(js|mjs)$/.test(file)) bucket = referenced.has(name) ? 'initialJs' : 'lazyJs';

  if (bucket) {
    const size = brotli(buf);
    buckets[bucket] += size;
    rows.push({ file: relative(distDir, file).replace(/\\/g, '/'), bucket, size });
  }
}

rows.sort((a, b) => b.size - a.size);

console.log('[check-bundle-size] Largest shipped files (brotli):');
for (const r of rows.slice(0, 12)) {
  console.log(`  ${kb(r.size).padStart(12)}  ${r.bucket.padEnd(11)}  ${r.file}`);
}

let failed = false;
console.log('\n[check-bundle-size] Budgets:');
for (const [key, budget] of Object.entries(BUDGETS)) {
  const actual = key === 'totalUnpacked' ? totalUnpacked : buckets[key];
  const ok = actual <= budget;
  if (!ok) failed = true;
  const pct = ((actual / budget) * 100).toFixed(0);
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(15)} ${kb(actual).padStart(12)} / ${kb(budget)} (${pct}%)`,
  );
}

if (failed) {
  console.error(
    '\n[check-bundle-size] Over budget. Raise the ceiling deliberately, with a reason.',
  );
  process.exit(1);
}
