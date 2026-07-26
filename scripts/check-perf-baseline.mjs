#!/usr/bin/env node
// Compares a fresh perf report against the checked-in baseline.
//
// This is deliberately NOT a pull-request gate. Timing on a shared self-hosted runner
// moves more with a neighbouring job than with most code changes, and a gate that goes
// red for reasons unrelated to the change is a gate people learn to click past. It runs
// nightly instead, against a baseline a human blessed, and files an issue when a number
// genuinely moves.
//
//   node scripts/check-perf-baseline.mjs perf/report.json [--summary perf/summary.md]
//                                        [--update]
//
// --update rewrites the baseline from the report, which is how a deliberate change to
// the numbers is accepted.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const reportPath = join(root, args.find((a) => !a.startsWith('--')) ?? 'perf/report.json');
const baselinePath = join(root, readArg('--baseline', 'perf/baseline.json'));
const summaryPath = readArg('--summary', null);
const update = args.includes('--update');

function log(message) {
  console.log(`[check-perf-baseline] ${message}`);
}

if (!existsSync(reportPath)) {
  console.error(`[check-perf-baseline] No report at ${reportPath}. Run perf-measure.mjs first.`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

function writeBaseline() {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
}

if (update) {
  writeBaseline();
  log(`Baseline updated from ${reportPath}. Commit it with a note on why the numbers moved.`);
  process.exit(0);
}

// The first run on a repo that has never recorded a baseline should be informative, not
// a failure. Seeding it here would also be wrong: a baseline nobody looked at is not a
// baseline, it is whatever the runner happened to produce that night.
if (!existsSync(baselinePath)) {
  log(`No baseline at ${baselinePath} yet. Today's numbers:`);
  for (const [key, metric] of Object.entries(report.metrics ?? {})) {
    log(`  ${key.padEnd(24)} ${metric.value} ${metric.unit}`);
  }
  log('Record one with `node scripts/check-perf-baseline.mjs perf/report.json --update`.');
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const format = (value, unit) =>
  unit === 'bytes' ? `${(value / 1000).toFixed(1)} kB` : `${value.toFixed(1)} ms`;

const rows = [];
const regressions = [];
const missing = [];

for (const [key, base] of Object.entries(baseline.metrics ?? {})) {
  const now = report.metrics?.[key];
  if (!now) {
    missing.push(key);
    continue;
  }

  // The report carries the tolerance so a metric can tighten its own band without every
  // consumer having to agree; the baseline's value is the fallback for older reports.
  const tolerance = now.tolerance ?? base.tolerance ?? 0.1;
  const ceiling = base.value * (1 + tolerance);
  const delta = base.value === 0 ? 0 : (now.value - base.value) / base.value;
  const regressed = now.value > ceiling;

  rows.push({
    key,
    baseline: format(base.value, base.unit),
    current: format(now.value, now.unit),
    delta: `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
    budget: `${(tolerance * 100).toFixed(0)}%`,
    regressed,
  });

  if (regressed) {
    regressions.push(
      `\`${key}\`: ${format(base.value, base.unit)} -> ${format(now.value, now.unit)} ` +
        `(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%, budget ${(tolerance * 100).toFixed(0)}%)`,
    );
  }
}

// A metric that vanished is a signal too: it usually means the measurement broke rather
// than that the cost went to zero, and silently passing would hide that.
for (const key of Object.keys(report.metrics ?? {})) {
  if (!(key in (baseline.metrics ?? {}))) log(`new metric, not yet in the baseline: ${key}`);
}

const width = Math.max(...rows.map((r) => r.key.length), 10);
const lines = [
  `| Metric${' '.repeat(Math.max(0, width - 6))} | Baseline | Current | Delta | Budget |`,
  `| ${'-'.repeat(width)} | -------- | ------- | ----- | ------ |`,
  ...rows.map(
    (r) =>
      `| ${(r.regressed ? `**${r.key}**` : r.key).padEnd(width)} | ${r.baseline} | ${r.current} | ` +
      `${r.delta} | ${r.budget} |`,
  ),
];

const summary = [
  `Baseline recorded ${baseline.recordedAt ?? 'unknown'}${baseline.commit ? ` at \`${baseline.commit}\`` : ''}.`,
  `Measured ${report.recordedAt}${report.commit ? ` at \`${report.commit}\`` : ''}` +
    `${report.runs ? ` over ${report.runs} run(s), median` : ''}.`,
  '',
  ...lines,
  '',
  ...(missing.length > 0
    ? [`Metrics present in the baseline but missing from this run: ${missing.join(', ')}.`, '']
    : []),
  ...(regressions.length > 0
    ? [
        `### ${regressions.length} regression(s)`,
        '',
        ...regressions.map((r) => `- ${r}`),
        '',
        'If the change is deliberate, refresh the baseline with',
        '`node scripts/check-perf-baseline.mjs perf/report.json --update` and commit it',
        'with the reason.',
      ]
    : ['No metric exceeded its budget.']),
].join('\n');

console.log(summary);

if (summaryPath) {
  const target = join(root, summaryPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${summary}\n`);
  log(`Wrote ${summaryPath}`);
}

// Missing metrics fail too: a measurement that stopped running is indistinguishable from
// one that never regressed, and only one of those is good news.
process.exit(regressions.length > 0 || missing.length > 0 ? 1 : 0);
