#!/usr/bin/env node
// Spec integrity gate.
//
// docs/spec/parity-inventory.md is a contract, not prose. An autonomous build pipeline
// consumes it, and the stable identifiers are the join key: what a plan, a pull
// request, a test name or a pipeline step cites when it claims to implement or verify
// a feature. A duplicated identifier silently makes two features one. A missing label
// makes a feature's honesty class unknowable. A hand-maintained count drifts the
// moment anyone edits the list, and a spec that misreports its own shape is exactly
// the overclaim the classification exists to prevent.
//
// So the identifiers and labels are checked mechanically, and the summary counts are
// recomputed from the items rather than trusted.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = join(root, 'docs', 'spec', 'parity-inventory.md');

if (!existsSync(inventoryPath)) {
  console.log('[check-spec] docs/spec/parity-inventory.md not present; skipping.');
  process.exit(0);
}

const LABELS = new Set(['LOCAL', 'EQUIV', 'DEGRADED', 'EXCLUDED', 'OPEN']);
const PREFIXES = new Set([
  'VIEW',
  'FIND',
  'MARK',
  'CMNT',
  'EDIT',
  'PAGE',
  'FORM',
  'SIGN',
  'CONV',
  'CMPR',
  'A11Y',
  'PRNT',
  'AUTO',
]);

const raw = readFileSync(inventoryPath, 'utf8');

// Line endings are their own failure, and a noisy one.
//
// .gitattributes normalises the repository to LF, and check-wasm-fresh.mjs compares
// artifacts byte for byte, so CRLF in the working tree is a real problem rather than a
// cosmetic one. It also arrives easily: any script that edits these files on Windows
// without asking for LF will write CRLF, which is exactly how it happened here.
//
// Parse anyway, so a line-ending slip does not masquerade as a missing inventory, but
// say plainly what it is. The first version of this gate reported "the item format has
// changed" for a CRLF file, which sent the diagnosis in the wrong direction.
const hasCrlf = raw.includes('\r\n');
const text = raw.replace(/\r\n/g, '\n');
const lines = text.split('\n');

// An item begins a checkbox line and owns every continuation line until the next item
// or a blank line, because labels and spike references can wrap.
const ITEM_START = /^\s*-\s*\[( |x|X)\]\s*`([A-Z0-9]+)-(\d{3})`(.*)$/;

const items = [];
let current = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(ITEM_START);
  if (m) {
    if (current) items.push(current);
    current = {
      line: i + 1,
      checked: m[1].toLowerCase() === 'x',
      prefix: m[2],
      num: m[3],
      id: `${m[2]}-${m[3]}`,
      body: m[4],
    };
  } else if (current && line.trim() && !/^\s*-\s*\[/.test(line)) {
    current.body += ` ${line.trim()}`;
  } else if (!line.trim()) {
    if (current) {
      items.push(current);
      current = null;
    }
  }
}
if (current) items.push(current);

const errors = [];
const seen = new Map();
const counts = Object.fromEntries([...LABELS].map((l) => [l, 0]));

for (const item of items) {
  if (!PREFIXES.has(item.prefix)) {
    errors.push(`${inventoryPath}:${item.line}  unknown prefix "${item.prefix}" in ${item.id}`);
  }

  if (seen.has(item.id)) {
    errors.push(
      `${inventoryPath}:${item.line}  duplicate identifier ${item.id} (first seen at line ${seen.get(item.id)}). ` +
        'Identifiers are assigned once and never reused.',
    );
  } else {
    seen.set(item.id, item.line);
  }

  // The label is the first backtick token that is a label word. Later ones are prose
  // ("better than the DEGRADED path"), so only the first counts.
  const tokens = [...item.body.matchAll(/`([A-Z]+)`/g)].map((t) => t[1]);
  const label = tokens.find((t) => LABELS.has(t));

  if (!label) {
    errors.push(
      `${inventoryPath}:${item.line}  ${item.id} carries no label. ` +
        `Every feature needs exactly one of: ${[...LABELS].join(', ')}.`,
    );
    continue;
  }
  counts[label]++;

  // An OPEN item must name the spike that resolves it, or "blocked" becomes a place
  // things go to be forgotten.
  if (label === 'OPEN' && !/spike/i.test(item.body)) {
    errors.push(
      `${inventoryPath}:${item.line}  ${item.id} is OPEN but names no spike. ` +
        'State which experiment resolves it.',
    );
  }

  // A DEGRADED item ships only with a disclosure, so it must say what is weaker.
  if (label === 'DEGRADED' && item.body.replace(/`[^`]*`/g, '').trim().length < 30) {
    errors.push(
      `${inventoryPath}:${item.line}  ${item.id} is DEGRADED but gives no reason. ` +
        'Say what is weaker than Acrobat, so the disclosure can be written.',
    );
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);

// Refuse to pass vacuously.
//
// This gate once reported "0 items, every feature labelled, summary consistent" and
// exited 0, because it read the file while another process was mid-write and parsed an
// empty result. A gate that passes when it parses nothing is worse than no gate: it
// reports the reassuring half of its job while doing none of it. The same discipline is
// already in check-no-egress.mjs and check-bundle-size.mjs and was missing here.
//
// The floor is deliberately far below the real count rather than pinned to it, so a
// deliberate reduction is possible without editing this file, while a parse that
// collapses to nothing still fails loudly.
const MINIMUM_PLAUSIBLE_ITEMS = 100;

if (items.length === 0) {
  console.error('[check-spec] Parsed zero items from a non-empty inventory.');
  console.error('[check-spec] Either the item format has changed, or the file was read');
  console.error('[check-spec] mid-write by another process.');
  process.exit(1);
}

if (hasCrlf) {
  errors.push(
    `${inventoryPath}  contains CRLF line endings. .gitattributes normalises this ` +
      'repository to LF, and check-wasm-fresh.mjs compares bytes, so CRLF in the working ' +
      'tree breaks that gate. Run `npx prettier -w` on the file, or configure whatever ' +
      'wrote it to emit LF.',
  );
}

if (total < MINIMUM_PLAUSIBLE_ITEMS) {
  console.error(
    `[check-spec] Only ${total} labelled items found, below the floor of ${MINIMUM_PLAUSIBLE_ITEMS}.`,
  );
  console.error('[check-spec] Refusing to pass: this is far more likely a parse failure');
  console.error(
    '[check-spec] than a real inventory. Lower the floor deliberately if it is real.',
  );
  process.exit(1);
}

console.log('[check-spec] Parity inventory:');
for (const [label, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const pct = total ? ((n / total) * 100).toFixed(1) : '0.0';
  console.log(`  ${String(n).padStart(4)}  ${label.padEnd(9)} ${pct.padStart(5)}%`);
}
console.log(`  ${String(total).padStart(4)}  TOTAL`);
console.log(`[check-spec] ${seen.size} unique identifiers across ${PREFIXES.size} prefixes.`);

// Cross-document citation check.
//
// The identifiers are a join key: a plan, a pull request, a test name or a pipeline step
// cites one when it claims to implement or verify a feature. A citation that points
// nowhere is a broken join, and it arrives easily through a typo, a deletion, or a
// renumber that missed a reference.
//
// BE CLEAR ABOUT WHAT THIS DOES NOT CATCH. In review, four of six citations in a draft
// were wrong, and all four pointed at identifiers that DO exist: SIGN-022 where SIGN-021
// was meant, CONV-018 for CONV-017, and so on. Both endpoints resolve, so this check
// would have passed every one of them. Catching a wrong-but-valid citation needs to know
// what the surrounding sentence means, which no mechanical check here can do.
//
// So this closes the cheap half: dangling references. The expensive half stays a review
// responsibility, and saying so is better than implying the gate covers it.
const CITATION = /\b([A-Z0-9]{4})-(\d{3})\b/g;

function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

let citations = 0;
for (const file of collectMarkdown(join(root, 'docs'))) {
  const body = readFileSync(file, 'utf8');
  const rel = relative(root, file).replace(/\\/g, '/');
  const reported = new Set();

  for (const m of body.matchAll(CITATION)) {
    const [cited, prefix] = [m[0], m[1]];
    if (!PREFIXES.has(prefix)) continue; // Not one of ours: a date, a code, prose.
    citations++;
    if (seen.has(cited) || reported.has(cited)) continue;
    reported.add(cited);
    const line = body.slice(0, m.index).split('\n').length;
    errors.push(
      `${rel}:${line}  cites ${cited}, which is not in the inventory. ` +
        'Identifiers are the join key; a citation that resolves to nothing is a broken link.',
    );
  }
}
console.log(
  `[check-spec] ${citations} identifier citations across docs/, all resolving. ` +
    'Wrong-but-valid citations are not detectable here and remain a review item.',
);

const specPath = join(root, 'docs', 'PRODUCT-SPEC.md');
if (existsSync(specPath)) {
  const spec = readFileSync(specPath, 'utf8');
  for (const [label, n] of Object.entries(counts)) {
    // Match "LOCAL 264" or "| `LOCAL` | 264 |" style assertions.
    const re = new RegExp('`?' + label + '`?[^0-9\\n]{0,24}(\\d{1,4})', 'g');
    for (const m of spec.matchAll(re)) {
      const claimed = Number(m[1]);
      // Only treat plausible count-like numbers as claims.
      if (claimed > 0 && claimed <= 1000 && claimed !== n && Math.abs(claimed - n) < 200) {
        errors.push(
          `docs/PRODUCT-SPEC.md  claims ${label} = ${claimed}, but the inventory contains ${n}. ` +
            'The items are authoritative; update the summary.',
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`\n[check-spec] ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log('[check-spec] Identifiers unique, every feature labelled, summary consistent.');
