#!/usr/bin/env node
// Proves the shipped bundle cannot talk to anyone but us.
//
// photo-tools can assert `connect-src 'none'` and grep for any outbound primitive at
// all. We cannot: the MuPDF WASM binary is fetched at runtime, so `fetch` legitimately
// appears in our bundle. The guarantee we CAN prove, and the one that actually matters
// for a local-first tool, is that no request can reach a third party.
//
// So: find every string literal that looks like a URL or host, and fail on any that is
// absolute and not same-origin. Relative and same-origin references are fine.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = process.argv[2] ? join(root, process.argv[2]) : join(root, 'dist');

if (!existsSync(distDir)) {
  console.error(`[check-no-egress] Build output not found at ${distDir}. Run the build first.`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|cjs|html|css)$/.test(entry)) out.push(full);
  }
  return out;
}

// Absolute URLs and protocol-relative references.
const ABSOLUTE_URL = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#][^\s'"`)]*)?/gi;

// Hosts that appear as inert text in a shipped bundle and are never fetched. Each
// entry needs a reason: this list is the only way to weaken the guarantee, so an
// unexplained addition should fail review.
const INERT_HOST = new RegExp(
  [
    // Spec and standards URIs used as identifiers, plus license/attribution text.
    'w3\\.org',
    'schema\\.org',
    'spdx\\.org',
    'gnu\\.org',
    'purl\\.org',
    // Adobe's XFDF namespace URI is serialized into local interchange files as an XML
    // identifier. It is never dereferenced or used as a request target.
    'ns\\.adobe\\.com/xfdf',
    // React interpolates this into minified error messages ("Visit
    // https://react.dev/errors/418 for the full message"). String only, never fetched.
    'react\\.dev/errors',
    // Tailwind writes a documentation pointer into a CSS comment.
    'tailwindcss\\.com',
    // Attribution for the engine and its license, in comments and the SBOM.
    'artifex\\.com',
    'mupdf\\.com',
  ].join('|'),
  'i',
);

const files = walk(distDir);
if (files.length === 0) {
  console.error('[check-no-egress] No shippable files found. Refusing to pass vacuously.');
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    if (INERT_HOST.test(match[0])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({ file: relative(root, file).replace(/\\/g, '/'), line, url: match[0] });
  }
}

if (findings.length > 0) {
  console.error('[check-no-egress] Third-party URLs found in shipped output:\n');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.url}`);
  console.error(
    '\nThis product makes a local-first promise. Every reference must be same-origin\n' +
      'or relative. If a URL is genuinely inert, add its host to INERT_HOST with a reason.',
  );
  process.exit(1);
}

console.log(`[check-no-egress] ${files.length} shipped file(s) scanned; no third-party URLs.`);
