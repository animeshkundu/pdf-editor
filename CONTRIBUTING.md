# Contributing

Thank you for helping. Keep contributions focused, testable, and consistent with the
local-first editor contract.

Read [`CLAUDE.md`](CLAUDE.md) and the ADRs in [`docs/adr/`](docs/adr/) before changing
behaviour. Several constraints in this repository look like arbitrary complexity until you
read why they exist.

## Prerequisites

### For TypeScript work

- Node.js 22.13 or newer, and npm.

That is all. The built WebAssembly artifacts are committed, so you do not need the native
toolchains to build and run the application
([ADR 0006](docs/adr/0006-three-toolchain-build-and-committed-wasm.md)).

```sh
npm ci
```

If your shell exports `NODE_ENV=production`, npm **skips `devDependencies`** and the build
then fails on a missing `vite`. Use:

```sh
npm ci --include=dev
```

### For engine work

This repository is three languages. Touching the engine layers needs their toolchains.

| Layer                    | Toolchain                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Forked MuPDF WASM (C)    | Emscripten (emsdk), on the version recorded in `vendor/wasm-manifest.json`            |
| `crates/pdftext` (Rust)  | Rust with the `wasm32-unknown-unknown` target, plus `wasm-bindgen-cli` and `wasm-opt` |
| Application (TypeScript) | Node 22.13+                                                                           |

Do not use `wasm-pack`. It was archived when the rustwasm organisation was sunset in July
2025; `wasm-bindgen-cli` plus `wasm-opt` is what it was wrapping.

`cargo-audit` is needed for `npm run check:supply`. It is optional locally and required in
CI.

The correctness oracles, **pdf.js** and **qpdf**, are test-only tools
([ADR 0019](docs/adr/0019-correctness-oracles.md)).

`scripts/cargo.mjs` and `scripts/build-wasm.mjs` exit 0 when their toolchain or source tree
is missing, so a partial setup never blocks you. CI has everything and is where those gates
bite.

## Development

```sh
npm run dev            # dev server
npm run build:web      # production build to dist/
npm run preview        # serve the production build
```

## Required checks

Before opening a pull request:

```sh
npm run check          # typecheck + lint (JS and Rust) + test (JS and Rust)
npm run build:web
npm run check:egress   # no third-party URL in shipped output
npm run check:size     # bundle budgets
npm run check:supply   # denylist + cargo audit + npm audit
npm run test:e2e       # Playwright against the production build
```

If you changed the C shim or the Rust crate, also:

```sh
npm run build:wasm
npm run check:wasm:fresh   # full mode, verifying source digests too
```

and commit the rebuilt artifacts together with the regenerated
`vendor/wasm-manifest.json`.

Changes that affect browser behaviour must also be driven manually against the production
build: exercise the workflow, in all three densities and both themes, with the keyboard
only, and with reduced motion actually enabled rather than assumed.

## Non-negotiable guardrails

Contributions must preserve:

- **Zero egress.** No upload, accounts, telemetry, analytics, error reporting, advertising,
  remote configuration, CDN assets, or third-party requests. The default-deny CSP in
  `web/index.html` stays exactly as it is
  ([ADR 0002](docs/adr/0002-client-side-only-zero-egress.md)).
- **WASM handle discipline.** `mupdf` is imported only inside `lib/engine/worker/`. Every
  handle is arena-owned and released in `finally`, in reverse order. There is no
  `FinalizationRegistry`, and a leaked handle leaks until the page reloads
  ([ADR 0009](docs/adr/0009-wasm-memory-and-handle-discipline.md)).
- **Project, assert, then mutate**, against the exact ceilings in `lib/core/limits.ts`
  ([ADR 0014](docs/adr/0014-resource-ceilings.md)).
- **The oracle rule.** MuPDF is never the acceptance reader for output MuPDF produced. Use
  pdf.js and qpdf ([ADR 0019](docs/adr/0019-correctness-oracles.md)).
- **Content streams rewritten through the engine**, via `pdf_filter_page_contents` with
  `pdf_new_sanitize_filter` ([ADR 0012](docs/adr/0012-content-stream-text-editing.md)).
- **The browser floor** of Chrome 95, Firefox 131, Safari 15.2, with no COOP/COEP headers
  ([ADR 0013](docs/adr/0013-supported-browser-matrix.md)).
- **The supply-chain denylist**: `rustybuzz`, `ttf-parser`, `rsa`
  ([ADR 0005](docs/adr/0005-rust-font-module-scope.md)).
- **WCAG 2.2 AA chrome**, the semantic-token layer, three densities, and light and dark as
  peers (ADRs [0015](docs/adr/0015-accessibility-and-no-positioned-dom-text.md) and
  [0016](docs/adr/0016-density-aware-design-tokens.md)).
- **Exact-pinned, AGPL-compatible dependencies**, recorded in
  [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md).

## Verify engine capability against source

MuPDF's published reference documents the union of the WebAssembly build and the
`mutool run` desktop interpreter. A large number of documented methods are marked
`[mutool run only]` and **do not exist in the browser build**. Check
`platform/wasm/lib/mupdf.c` at the version in use. It is small, and reading it is faster
than debugging a wrong assumption.

## Commits and pull requests

- One bounded concern per pull request.
- Add or update tests with every behaviour change and every fix. A test for a fix must fail
  against the original bug.
- Explain the user-visible effect, the safety implications, and the verification you
  actually performed. Record unverified behaviour as a gap, not as passing.
- A decision with lasting consequences gets an ADR in the same pull request. An ADR
  contradicted by evidence is superseded, not quietly edited.
- Record user-visible changes in [`docs/CHANGELOG.md`](docs/CHANGELOG.md) under
  `[Unreleased]`, and durable lessons in [`docs/LEARNINGS.md`](docs/LEARNINGS.md) or
  [`docs/history/`](docs/history/).
- Avoid unrelated formatting, refactors, dependency updates, or generated-file churn.
- **No attribution to generative or automated tooling** anywhere: commits, pull requests,
  issues, code, comments, or docs.

The reviewer will work through [`docs/qa/review-rubric.md`](docs/qa/review-rubric.md).
Reading it before you open the pull request will save you a round trip.
