# 0002. Client-side only, with a zero-egress posture we can prove

## Status

Accepted

## Date

2026-07-26

## Context

The documents this product edits are contracts, medical records, tax filings, and
signed agreements. The single most valuable property such a tool can have is that the
file never leaves the device, and the second most valuable is that the claim is
checkable rather than promised.

Every hosted competitor, including Adobe's own web surface, uploads the document. That
is the wedge: a full editor with no server to upload to.

There is one honest complication. MuPDF's WebAssembly binary is fetched from our own
origin at runtime, so we cannot assert `connect-src 'none'` the way a pure-JavaScript
tool could, and the string `fetch` legitimately appears in our bundle. A guarantee
stated as "no network primitives at all" would be false, and a false guarantee is worse
than a narrower true one.

## Decision

The product is a static site with no server component, no account system, no telemetry,
no analytics, no advertising, no remote configuration, and no runtime asset
provisioning from any origin but our own.

The posture is enforced at three levels.

1. **Content Security Policy.** `web/index.html` carries a default-deny policy:
   `default-src 'none'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
   `form-action 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`.
   `script-src` is `'self' 'wasm-unsafe-eval'`. The `'wasm-unsafe-eval'` token is
   required to compile WebAssembly and does not permit `eval()` of JavaScript. This
   policy is part of the product contract and may not be widened without a superseding
   ADR.

2. **Static proof.** `scripts/check-no-egress.mjs` scans every shipped `.js`, `.mjs`,
   `.cjs`, `.html`, and `.css` file for absolute or protocol-relative URLs and fails on
   any that is not same-origin. It refuses to pass vacuously when the output directory
   is empty. Hosts that appear as inert text (specification URIs, licence text, React's
   minified-error pointer, the Tailwind documentation comment, engine attribution) are
   listed individually in `INERT_HOST` with a stated reason. That allowlist is the only
   way to weaken the guarantee, so an unexplained addition should fail review.

3. **Runtime proof.** `tests/e2e/shell.e2e.ts` drives the production artifact and fails
   if the page issues any request whose origin is not the preview origin, and separately
   fails on any console error. The static scan proves no third-party URL is present; the
   runtime check proves none is contacted.

The claim we make in user-facing copy is precise: the application's static assets are
served over the network on a cold start, and after load no document byte, page image,
filename, or derived artifact enters any request.

### What these gates prove, and what they do not

Stating this exactly is the point of the ADR.

**Proven.** No third-party URL is present in the shipped output, and the running
application contacts no foreign origin during the E2E run. Combined with the CSP, a
request to a third party is blocked by the browser regardless of what the code attempts.

**Not proven by the gates.** A **same-origin** request carrying document bytes would pass
both. What rules that out is structural rather than mechanical: the deployment is static
hosting with no serverless function, no edge middleware, and no endpoint to receive a
POST ([`../PUBLISHING.md`](../PUBLISHING.md)). Those exclusions are review items, not
executable checks, which is why they are named as merge blockers in
[`../qa/review-rubric.md`](../qa/review-rubric.md). If a same-origin egress gate becomes
practical, it belongs here.

**Also not enforced by the meta CSP.** `frame-ancestors` is ignored when a policy is
delivered in a `<meta>` element; it is only honoured as a response header. The meta
policy still declares it for documentation value, and the effective protection comes from
the `Content-Security-Policy` and `X-Frame-Options` response headers configured in
`vercel.json`.

## Consequences

### Positive

- The privacy claim is verifiable by a reader of the repository, not just believable.
- The product works offline once loaded, which is the natural behaviour rather than an
  added feature.
- Regulatory and enterprise objections about document handling have a structural answer.

### Negative

- Nothing can be moved to a server for convenience: OCR, font subsetting, signature
  validation, and rendering all have to run in the browser under a 2 GiB memory ceiling
  (ADR 0014).
- Crash reporting and usage analytics are unavailable, so quality relies on tests and
  reproducible bug reports rather than on field telemetry.

### Neutral

- `connect-src 'self'` is weaker than `'none'` and always will be, for as long as the
  engine is a separately fetched WASM binary. The compensating controls above are the
  reason that is acceptable.

## Notes

Enforced by `scripts/check-no-egress.mjs`, `web/index.html`, and
`tests/e2e/shell.e2e.ts`. Related: [ADR 0017](0017-persistence-via-opfs.md) keeps
persistence on-device, and [ADR 0018](0018-signing-via-custom-signer-vtable.md) keeps
signing keys on-device.
