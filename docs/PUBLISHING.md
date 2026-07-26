# Publishing

The product is a static site. There is no server, no serverless function, no edge
middleware, and no build step that executes project code on someone else's
infrastructure beyond a plain `vite build`.

## Vercel, through the native Git integration

Deployment uses Vercel's Git integration rather than a CI-driven prebuilt upload. The
project configuration lives in `vercel.json` at the repository root, which pins the
framework preset to `null`, the build command to `npm run build:vercel`, the output
directory to `dist`, and the install command to `npm ci --include=dev`. It also sets the
response headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, a transport-level CSP
carrying `frame-ancestors`, `base-uri`, and `object-src`, the correct
`application/wasm` content type, and immutable caching for content-hashed assets.

The transport CSP complements, and does not replace, the default-deny policy in
`web/index.html`. That document policy remains the contract
([ADR 0002](adr/0002-client-side-only-zero-egress.md)).

`build:vercel` is deliberately not `build`. It runs
`node scripts/check-wasm-fresh.mjs --manifest-only` followed by `vite build`. Vercel's
build image has Node but has neither Emscripten nor Rust, so it cannot compile the WASM
layers. It does not need to: the built artifacts are committed, and the manifest check
proves they match the source they claim to come from
([ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md)). A tampered or stale
artifact fails the deploy rather than shipping.

### `NODE_ENV` on the build machine

If `NODE_ENV=production` is set in the Vercel project's environment variables, a plain
`npm ci` skips `devDependencies`, and the build fails on a missing `vite`. This is why
`vercel.json` pins the install command to `npm ci --include=dev`. The same trap exists in
local shells that export `NODE_ENV=production` globally.

### What must never be added

- Vercel Analytics, Speed Insights, or any other injected script. Each adds a
  third-party request, which contradicts
  [ADR 0002](adr/0002-client-side-only-zero-egress.md) and trips
  `scripts/check-no-egress.mjs`.
- Edge middleware or serverless functions. There is no server, and adding one changes what
  the product is.
- Any rewrite or header that weakens the Content Security Policy in `web/index.html`.

The response headers Vercel adds (TLS, HSTS, immutable caching for content-hashed assets)
are welcome. Nothing that observes the user is.

## AGPL section 13

The application is conveyed to users over a network, so section 13 of the AGPL applies:
users must be offered the corresponding source of the version they are running
([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).

The deployed site therefore carries a visible link to the repository and identifies the
exact commit it was built from. This includes the MuPDF fork's patch set, which is a
derivative work of an AGPL-3.0-or-later program.

This obligation is not optional and is not satisfied by a licence file alone. It is a
release-checklist item.

## Release checklist

- [ ] `npm ci` succeeds from the committed lockfile on a clean checkout.
- [ ] `npm run check` passes (typecheck, lint, test, both JavaScript and Rust).
- [ ] `npm run build` succeeds, including the WASM layers, on a machine with all three
      toolchains.
- [ ] `npm run check:wasm:fresh` passes in **full** mode, verifying source digests as well
      as artifact digests.
- [ ] `npm run check:egress` passes against the fresh `dist/`.
- [ ] `npm run check:size` passes against the fresh `dist/`.
- [ ] `npm run check:supply` passes, with `cargo audit` available.
- [ ] `npm run test:e2e` passes in Chromium and Firefox against the production build.
- [ ] Safari and iOS Safari checked manually. There is no automated WebKit coverage yet;
      say so rather than implying there is.
- [ ] The accessibility pass in [`qa/review-rubric.md`](qa/review-rubric.md) has been
      driven, not inferred from CSS.
- [ ] All three densities and both themes inspected.
- [ ] User-facing copy names only shipped behaviour. Anything from
      [`ROADMAP.md`](ROADMAP.md) that has not landed is not mentioned as available.
- [ ] The source link and commit identifier on the deployed site are correct.
- [ ] [`CHANGELOG.md`](CHANGELOG.md) updated, [`THIRD-PARTY.md`](THIRD-PARTY.md) matches
      `package.json` and `Cargo.lock` exactly.
- [ ] No attribution to generative or automated tooling anywhere in the diff, commits,
      pull request, or artifacts.

## Not yet fixed

The production domain is not settled. When it is, record it here along with the canonical
URL, and keep any `robots.txt`, `sitemap.xml`, and `.well-known/security.txt` consistent
with it and with [`../SECURITY.md`](../SECURITY.md).
