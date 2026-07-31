#!/usr/bin/env node
// Verifies a live deployment before it is trusted.
//
// The build gates prove things about the bytes on disk. They cannot prove that the
// headers in vercel.json actually reach a browser, that the WASM binary is served with
// the MIME type streaming instantiation requires, or that HTML is not pinned in a CDN
// cache. This asserts those end to end against a deployed URL, so a broken deployment
// fails loudly instead of sitting in production unnoticed.
//
//   node scripts/check-deployment.mjs https://example.vercel.app [--require-wasm]
//
// Transport compression is reported but not gated: it is the platform's to provide, and
// HTTP clients routinely decode and strip `content-encoding` before it can be observed.

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
const requireWasm = args.includes('--require-wasm');

if (!base) {
  process.stderr.write(
    '[check-deployment] FAIL: usage: check-deployment.mjs <base-url> [--require-wasm]\n',
  );
  process.exit(1);
}

// Every one of these is configured in vercel.json. Asserting presence here is what stops
// a refactor of that file from silently dropping one.
const SECURITY_HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'content-security-policy',
  'permissions-policy',
];

// Deliberately absent, and asserted absent so nobody adds them back by reflex.
//
// Cross-origin isolation (COOP + COEP) exists to unlock SharedArrayBuffer. Our MuPDF
// build is single-threaded with no `-pthread`, so we never allocate one. Turning
// isolation on would buy nothing and would break every cross-origin embed and popup for
// users who legitimately frame or open the editor. If the engine ever grows a threaded
// build, this list is the place that has to change first, on purpose.
const FORBIDDEN_HEADERS = ['cross-origin-opener-policy', 'cross-origin-embedder-policy'];

// Hosts that may legitimately appear as inert text in shipped output. Kept in step with
// the INERT_HOST list in scripts/check-no-egress.mjs: this check is the runtime half of
// the same promise, and a host allowed there must be allowed here or the two disagree.
const INERT_HOST =
  /(w3\.org|schema\.org|spdx\.org|gnu\.org|purl\.org|ns\.adobe\.com\/xfdf|react\.dev\/errors|tailwindcss\.com|artifex\.com|mupdf\.com)/i;

const ABSOLUTE_URL = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#][^\s'"`)]*)?/gi;

// Vercel Authentication answers 401 to an unauthenticated client on every preview URL.
// The automation bypass header is the supported way through; without the secret the
// checks still run, which is correct when the target is a production custom domain.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const BYPASS_HEADERS = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'false' }
  : {};

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function visit(pathname, headers = {}) {
  const url = pathname.startsWith('http') ? pathname : `${base}${pathname}`;
  try {
    // Manual redirect: a redirect must be observed, not silently followed.
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { ...BYPASS_HEADERS, ...headers },
    });
    if (response.status === 401 && !BYPASS) {
      failures.push(
        `${pathname}: 401. Deployment protection is on and ` +
          'VERCEL_AUTOMATION_BYPASS_SECRET is not set.',
      );
    }
    return { url, status: response.status, headers: response.headers, response };
  } catch (error) {
    failures.push(`${pathname}: request failed (${error.message}).`);
    return null;
  }
}

function expectSecurityHeaders(label, result) {
  for (const header of SECURITY_HEADERS) {
    check(result.headers.get(header) !== null, `${label}: missing ${header}.`);
  }
  for (const header of FORBIDDEN_HEADERS) {
    check(
      result.headers.get(header) === null,
      `${label}: ${header} is set. Cross-origin isolation is deliberately off; ` +
        'see the comment in this file before adding it.',
    );
  }
}

function expectNoThirdPartyUrls(label, text) {
  const found = [...text.matchAll(ABSOLUTE_URL)]
    .map((m) => m[0])
    .filter((url) => !INERT_HOST.test(url))
    .filter((url) => !url.startsWith(base));
  for (const url of new Set(found)) {
    failures.push(`${label}: references a third-party origin (${url}).`);
  }
}

// --- the entry document -----------------------------------------------------------

const rootRedirect = await visit('/');
if (rootRedirect) {
  check(rootRedirect.status === 308, `/: expected 308, got ${rootRedirect.status}.`);
  check(
    rootRedirect.headers.get('location') === '/pdf/',
    `/: expected Location: /pdf/, got ${rootRedirect.headers.get('location')}.`,
  );
}

const landing = await visit('/pdf/');
if (landing) {
  check(landing.status === 200, `/pdf/: expected 200, got ${landing.status}.`);
  expectSecurityHeaders('/pdf/', landing);
  const landingHtml = await landing.response.text();
  expectNoThirdPartyUrls('/pdf/', landingHtml);
}

const index = await visit('/pdf/app/');
let html = '';

if (index) {
  check(index.status === 200, `/pdf/app/: expected 200, got ${index.status}.`);
  check(
    (index.headers.get('content-type') ?? '').includes('text/html'),
    `/pdf/app/: expected text/html, got ${index.headers.get('content-type')}.`,
  );
  expectSecurityHeaders('/pdf/app/', index);

  const policy = index.headers.get('content-security-policy') ?? '';
  check(
    policy.includes("frame-ancestors 'none'"),
    `/pdf/app/: CSP missing frame-ancestors 'none'.`,
  );
  check(
    (index.headers.get('x-frame-options') ?? '').toUpperCase() === 'DENY',
    `/: expected X-Frame-Options: DENY, got ${index.headers.get('x-frame-options')}.`,
  );
  check(
    (index.headers.get('referrer-policy') ?? '') === 'no-referrer',
    `/: expected Referrer-Policy: no-referrer, got ${index.headers.get('referrer-policy')}.`,
  );
  check(
    (index.headers.get('x-content-type-options') ?? '').toLowerCase() === 'nosniff',
    `/: expected X-Content-Type-Options: nosniff, got ${index.headers.get('x-content-type-options')}.`,
  );

  // An immutably cached HTML document pins a release in every intermediary cache and
  // there is no way to publish a fix. This must revalidate.
  const cacheControl = index.headers.get('cache-control') ?? '';
  check(
    /(?:max-age=0|no-cache|no-store|must-revalidate)/.test(cacheControl),
    `/: expected a revalidating Cache-Control, got "${cacheControl}".`,
  );
  check(
    !cacheControl.includes('immutable'),
    `/: HTML is marked immutable ("${cacheControl}"). A release could never be superseded.`,
  );

  if (index.status === 200) {
    html = await index.response.text();
    expectNoThirdPartyUrls('/', html);
  }
}

// --- hashed assets ------------------------------------------------------------------

// Read out of the served HTML rather than guessed, so a content-hash change cannot make
// this silently vacuous.
const scriptPath = html.match(/(?:src|href)="(\/pdf-editor\/app\/assets\/[^"]+\.js)"/)?.[1];
const stylePath = html.match(/href="(\/pdf-editor\/app\/assets\/[^"]+\.css)"/)?.[1];

if (!scriptPath) {
  failures.push('/: no hashed module script found in the served HTML.');
}

let entryJs = '';
for (const [path, kind] of [
  [scriptPath, 'javascript'],
  [stylePath, 'css'],
]) {
  if (!path) continue;
  const result = await visit(path);
  if (!result) continue;

  check(result.status === 200, `${path}: expected 200, got ${result.status}.`);
  check(
    (result.headers.get('content-type') ?? '').includes(kind),
    `${path}: expected a ${kind} content type, got ${result.headers.get('content-type')}.`,
  );

  const cacheControl = result.headers.get('cache-control') ?? '';
  check(
    cacheControl.includes('immutable') && cacheControl.includes('max-age=31536000'),
    `${path}: expected immutable one-year caching, got "${cacheControl}".`,
  );
  expectSecurityHeaders(path, result);

  if (result.status === 200) {
    const body = await result.response.text();
    expectNoThirdPartyUrls(path, body);
    if (kind === 'javascript') entryJs = body;

    const encoded = await visit(path, { 'accept-encoding': 'br, gzip' });
    notes.push(
      `transport compression on ${path}: ` +
        `${encoded?.headers.get('content-encoding') ?? 'not observable from this client'}`,
    );
  }
}

// Vite keeps the engine in a lazy chunk, so the WASM URL is not necessarily present in the
// entry module. Follow emitted JavaScript references until the reachable module graph is
// exhausted, applying the same header and egress checks to every discovered chunk.
const javascriptBodies = [entryJs];
const visitedJavaScript = new Set(scriptPath ? [scriptPath] : []);
const pendingJavaScript = [];
const JS_REFERENCE = /(?:\/pdf-editor\/app\/assets\/|\.\/)[A-Za-z0-9._-]+\.js/g;
const mountedAssetPath = (reference) =>
  reference.startsWith('./') ? `/pdf-editor/app/assets/${reference.slice(2)}` : reference;
for (const body of javascriptBodies) {
  for (const match of body.matchAll(JS_REFERENCE)) {
    const reference = match[0] ? mountedAssetPath(match[0]) : '';
    if (reference && !visitedJavaScript.has(reference)) pendingJavaScript.push(reference);
  }
}
while (pendingJavaScript.length > 0) {
  const path = pendingJavaScript.shift();
  if (!path || visitedJavaScript.has(path)) continue;
  visitedJavaScript.add(path);
  const result = await visit(path);
  if (!result) continue;
  check(result.status === 200, `${path}: expected 200, got ${result.status}.`);
  expectSecurityHeaders(path, result);
  if (result.status !== 200) continue;
  const body = await result.response.text();
  javascriptBodies.push(body);
  expectNoThirdPartyUrls(path, body);
  for (const match of body.matchAll(JS_REFERENCE)) {
    const reference = match[0] ? mountedAssetPath(match[0]) : '';
    if (reference && !visitedJavaScript.has(reference)) pendingJavaScript.push(reference);
  }
}

// --- the WASM binary ------------------------------------------------------------------

// Discovered from what is actually served rather than hardcoded, because the engine
// chunk owns the URL and it is content-hashed.
const wasmReference = (html + javascriptBodies.join('')).match(
  /(?:\/pdf-editor\/app\/assets\/|\.\/)[A-Za-z0-9._-]+\.wasm/,
)?.[0];
const wasmPath = wasmReference ? mountedAssetPath(wasmReference) : undefined;

if (!wasmPath) {
  const message =
    'no .wasm reference found in the served HTML or entry chunk. ' +
    'The engine is not wired up yet, so the MIME-type assertion has nothing to check.';
  if (requireWasm) failures.push(`/: ${message}`);
  else notes.push(message);
} else {
  const result = await visit(wasmPath);
  if (result) {
    check(result.status === 200, `${wasmPath}: expected 200, got ${result.status}.`);
    // WebAssembly.instantiateStreaming rejects anything that is not exactly this type,
    // and the fallback path costs an extra full-buffer copy of a multi-megabyte binary.
    check(
      (result.headers.get('content-type') ?? '').startsWith('application/wasm'),
      `${wasmPath}: expected application/wasm, got ${result.headers.get('content-type')}.`,
    );
    const cacheControl = result.headers.get('cache-control') ?? '';
    check(
      cacheControl.includes('immutable') && cacheControl.includes('max-age=31536000'),
      `${wasmPath}: expected immutable one-year caching, got "${cacheControl}".`,
    );
    expectSecurityHeaders(wasmPath, result);
  }
}

// --- report ---------------------------------------------------------------------------

for (const note of notes) process.stdout.write(`[check-deployment] note: ${note}\n`);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[check-deployment] FAIL: ${failure}\n`);
  process.stderr.write(
    `[check-deployment] ${failures.length} check(s) failed against ${base}.\n`,
  );
  process.exit(1);
}

process.stdout.write(`[check-deployment] all checks passed against ${base}.\n`);
