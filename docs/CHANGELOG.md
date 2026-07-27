# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once versioned
releases are published.

Nothing has been released yet. The repository is at `0.0.0`.

## [Unreleased]

### Added

- Repository scaffold: Vite 8, React 19, strict TypeScript 6, Tailwind 4, Vitest, and
  Playwright against the production build.
- `lib/core/limits.ts`, the resource-ceiling contract and the project-assert-then-mutate
  gate, with boundary coverage in `tests/limits.test.ts`.
- Two-tier design token system with `compact` / `comfortable` / `touch` density and
  light and dark as peers, in `assets/tailwind.css`.
- Structural editor shell with the skip link, single `h1`, and labelled landmarks.
- Gate scripts: `check-no-egress`, `check-wasm-fresh`, `check-supply-chain`, and
  `check-bundle-size`.
- Documentation set and ADRs 0001 through 0019 under `docs/adr/`.
- Product specification draft: the five-label parity classification, a 308-item feature
  inventory with stable identifiers, the competitor-win set, and the UI and UX
  specification under `docs/spec/`.
- MuPDF vendoring via `scripts/vendor-mupdf.mjs`, with the stock from-source WASM build
  verified byte-identical to Artifex's published artifact.
- Forked MuPDF 1.28.0 artifacts with a buffered 85-operator processor bridge, resolved
  font/marked-content/image bindings, and an independently graded sanitize-filter harness.
- A fixed 13-document redistributable oracle corpus, rendered by pdf.js at 144 dpi and
  structurally checked by qpdf.
- Phase 3 viewer: local file open, worker-isolated MuPDF rendering in 512 px tiles,
  virtualized continuous pages, zoom and navigation, whole-document search, structured-text
  selection and copy, a canvas highlight layer, an assistive structured-text surface, thumbnails,
  outline, attachments, and a keyboard command palette.
- In-product `LOCAL`, `EQUIV`, `DEGRADED`, `EXCLUDED`, and `OPEN` disclosures that distinguish
  the shipped viewer from withdrawn content rewriting, redaction, and unproven signing.

### Changed

- Content-stream editing, true redaction, existing object rewrites, and marked-content
  tagging were withdrawn after the null filter produced diffuse render perturbations.

### Deprecated

### Removed

### Fixed

### Security

- Default-deny Content Security Policy in `web/index.html`.
- Updated ESLint's transitive `brace-expansion` dependency to the patched 5.0.8 release.
- Zero-egress proof in two layers: a static scan of the shipped bundle
  (`scripts/check-no-egress.mjs`) and a runtime assertion that the running application
  contacts no foreign origin (`tests/e2e/shell.e2e.ts`).
- Supply-chain denylist for `rustybuzz` (RUSTSEC-2026-0206), `ttf-parser`
  (RUSTSEC-2026-0192), and `rsa` (RUSTSEC-2023-0071), enforced by
  `scripts/check-supply-chain.mjs`.
