# Publishing

The product is a static site. There is no server, no serverless function, no edge
middleware, and no build step that executes project code on someone else's
infrastructure beyond a plain `vite build`.

## Vercel, driven from CI

Deployment runs from `.github/workflows/deploy.yml` rather than Vercel's native Git
integration, and is gated on CI passing
([ADR 0021](adr/0021-deploy-through-ci-rather-than-git-integration.md)). Vercel builds
from `vercel.json`, which knows nothing about `npm run check`, `check:egress` or
`check:size`; under the Git integration a commit that failed every gate would still reach
a URL. The workflow triggers on the CI run completing, refuses to proceed unless it
succeeded, and checks out the exact commit CI verified. `main` goes to production and
every other branch gets a preview.

**The Git integration must stay disconnected once this is in effect.** Two mechanisms
deploying the same project would race for the production alias, and the ungated one
winning would make the gate pointless. As of 2026-07-27 the Git integration IS connected
and is what deploys; `deploy.yml` holds no credentials and skips, so nothing conflicts
yet. Disconnect it before setting the three secrets below.

Deployment needs three repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`. Without them the workflow says so in its summary and exits green,
the same way `scripts/cargo.mjs` skips for a contributor with no Rust toolchain.

### Mounting the app under a path

`vite.web.config.ts` reads `PDF_EDITOR_BASE` and defaults to `/`, which is what a
standalone deployment serves and what every gate and the Playwright suite assume. Set it
at build time to mount the app under a path:

```sh
PDF_EDITOR_BASE=/pdf-editor/ npm run build:web
```

The value must have a leading and trailing slash. Vite joins it to asset paths verbatim,
so a missing trailing slash silently produces `/pdf-editorassets/...`; the config rejects
that rather than shipping it. On Git Bash for Windows, MSYS path conversion rewrites a
leading-slash value into a Windows path, so prefix the command with `MSYS_NO_PATHCONV=1`.

The prefix reaches more than the HTML. Verified on a `/pdf-editor/` build: the entry
chunk, the stylesheet, `doc.worker`, `search.worker` and `mupdf-wasm.wasm` all resolve
under it. That matters because the workers are loaded through
`new Worker(new URL(...))` and the engine through a `?url` import, and a base that failed
to reach them would produce an app that renders its shell and then cannot open a
document.

This exists because a sibling deployment mounts several apps on one domain, each serving
assets from a distinct prefix so two apps cannot collide over `/assets/`. Routing the
path itself is a deployment concern outside this repository: something must rewrite
`/<path>/*` to this project. The build only controls where the app expects its own assets
to live.

With Vercel's Deployment Protection enabled, an unauthenticated request to a deployment
answers `302` to `vercel.com/sso-api` with a `text/plain` body. Every header assertion in
`scripts/check-deployment.mjs` then fails against a deployment that is perfectly healthy,
because the check is reading the SSO redirect rather than the app.

`VERCEL_AUTOMATION_BYPASS_SECRET` is the supported way through. The script reads it and
sends `x-vercel-protection-bypass`; `deploy-check.yml` and `deploy.yml` both pass it. Set
it whenever protection is on, or the smoke test reports ten failures that mean nothing.

The project configuration lives in `vercel.json` at the repository root, which pins the
framework preset to `null`, the build command to `npm run build:vercel`, the output
directory to `dist`, and the install command to `npm ci --include=dev`. It also sets the
response headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, a transport-level CSP
carrying `frame-ancestors`, `base-uri`, and `object-src`, the correct
`application/wasm` content type, and immutable caching for content-hashed assets.

Vercel still builds rather than receiving CI's `dist/` as prebuilt output. Uploading
prebuilt output would mean restating every one of those headers in Build Output API form,
and two copies of a security header set is how one of them goes stale. `deploy.yml`
asserts the headers that actually arrived by running `scripts/check-deployment.mjs`
against the deployed URL.

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
