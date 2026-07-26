#!/usr/bin/env node
// Measures the numbers that describe how the shipped app actually feels, and writes
// them as JSON for scripts/check-perf-baseline.mjs to compare against a checked-in
// baseline.
//
// Two families of metric, measured differently on purpose:
//
//   * Bytes are deterministic. The same input always brotli-compresses to the same
//     size, so a change here is always real and the tolerance can be tight.
//   * Timings are not. These run on shared self-hosted runners where a neighbouring
//     job moves the number more than most code changes do, which is exactly why the
//     perf gate is nightly and advisory rather than a blocking pull-request check. A
//     flaky gate on every pull request trains people to ignore it, and then it is worse
//     than no gate at all.
//
// Timings are taken against the PRODUCTION preview server, not the dev server, because
// dev-transform module graphs bear no relation to what a user downloads.
//
//   node scripts/perf-measure.mjs [--out perf/report.json] [--runs 5]

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');

const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const outPath = join(root, readArg('--out', 'perf/report.json'));
const runs = Number(readArg('--runs', '5'));
const PORT = 4181;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Bytes are reproducible, so a small drift is a real change. Timings on a shared runner
// are not, so the band has to be wide enough that ordinary contention does not trip it.
const BYTE_TOLERANCE = 0.05;
const TIME_TOLERANCE = 0.3;

function log(message) {
  console.log(`[perf-measure] ${message}`);
}

if (!existsSync(distDir)) {
  console.error('[perf-measure] No dist/. Run `npm run build` first.');
  process.exit(1);
}

// --- bytes ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const brotli = (buf) =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const files = walk(distDir);
if (files.length === 0) {
  console.error('[perf-measure] dist/ is empty. Refusing to record a vacuous baseline.');
  process.exit(1);
}

// "Initial" is whatever the entry HTML pulls in with a plain script or link, matching how
// scripts/check-bundle-size.mjs buckets the same files.
const referenced = new Set();
for (const file of files.filter((f) => f.endsWith('.html'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (m[1]) referenced.add(m[1].replace(/^\.?\//, '').split('/').pop());
  }
}

const bytes = { initialJsBrotli: 0, initialCssBrotli: 0, lazyJsBrotli: 0, wasmBrotli: 0 };
let totalUnpackedBytes = 0;

for (const file of files) {
  const buf = readFileSync(file);
  const name = file.split(/[\\/]/).pop();
  totalUnpackedBytes += buf.length;

  let bucket = null;
  if (file.endsWith('.wasm')) bucket = 'wasmBrotli';
  else if (file.endsWith('.css')) bucket = referenced.has(name) ? 'initialCssBrotli' : 'lazyJsBrotli';
  else if (/\.(js|mjs)$/.test(file)) bucket = referenced.has(name) ? 'initialJsBrotli' : 'lazyJsBrotli';

  if (bucket) bytes[bucket] += brotli(buf);
}

// --- timings --------------------------------------------------------------------------

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

let timings = null;
let chromium = null;
let preview = null;
try {
  ({ chromium } = await import('@playwright/test'));
  ({ preview } = await import('vite'));
} catch {
  log('Playwright or Vite is not installed; recording byte metrics only.');
}

if (chromium && preview) {
  log(`Starting the production preview server on ${ORIGIN}`);
  // Vite's preview server is started in-process rather than through `npm run preview`.
  // A spawned npm wrapper does not forward signals to the vite child, so killing it can
  // leave the port held and the next run failing on --strictPort for no good reason.
  const server = await preview({
    configFile: join(root, 'vite.web.config.ts'),
    preview: { port: PORT, strictPort: true, host: '127.0.0.1' },
  });

  try {
    const browser = await chromium.launch();
    const samples = { firstContentfulPaintMs: [], domContentLoadedMs: [], loadEventMs: [] };

    for (let i = 0; i < runs; i++) {
      // A fresh context per run: a warm HTTP cache would measure the second visit, and
      // the number that matters is what a new user waits for.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(ORIGIN, { waitUntil: 'load' });

      const sample = await page.evaluate(async () => {
        // The paint entry is not guaranteed to exist by the load event, so it is
        // observed rather than read once. Reading it once is why an earlier version of
        // this script silently recorded no FCP at all, and a metric that quietly stops
        // being measured is worse than one that is never collected.
        const firstContentfulPaintMs = await new Promise((resolve) => {
          const seen = performance.getEntriesByName('first-contentful-paint')[0];
          if (seen) return resolve(seen.startTime);

          const observer = new PerformanceObserver((list) => {
            const entry = list.getEntriesByName('first-contentful-paint')[0];
            if (entry) {
              observer.disconnect();
              resolve(entry.startTime);
            }
          });
          observer.observe({ type: 'paint', buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(null);
          }, 10_000);
        });

        const nav = performance.getEntriesByType('navigation')[0];
        return {
          firstContentfulPaintMs,
          domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
          loadEventMs: nav ? nav.loadEventEnd : null,
        };
      });

      for (const [key, value] of Object.entries(sample)) {
        if (typeof value === 'number' && Number.isFinite(value)) samples[key].push(value);
      }
      await context.close();
    }

    await browser.close();

    timings = {};
    for (const [key, values] of Object.entries(samples)) {
      if (values.length > 0) timings[key] = Math.round(median(values) * 100) / 100;
      else console.error(`[perf-measure] no samples collected for ${key}.`);
    }
  } catch (error) {
    // A measurement failure must not be reported as a passing perf run, but it is also
    // not a code regression. Say so plainly and let the caller decide.
    console.error(`[perf-measure] timing measurement failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

// --- report -----------------------------------------------------------------------------

const metrics = {};
for (const [key, value] of Object.entries({ ...bytes, totalUnpackedBytes })) {
  metrics[key] = { value, unit: 'bytes', tolerance: BYTE_TOLERANCE };
}
for (const [key, value] of Object.entries(timings ?? {})) {
  metrics[key] = { value, unit: 'ms', tolerance: TIME_TOLERANCE };
}

const report = {
  recordedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  runs: timings ? runs : 0,
  metrics,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

log(`Wrote ${outPath}`);
for (const [key, metric] of Object.entries(metrics)) {
  const shown = metric.unit === 'bytes' ? `${(metric.value / 1000).toFixed(1)} kB` : `${metric.value} ms`;
  log(`  ${key.padEnd(24)} ${shown}`);
}
