# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once versioned
releases are published.

Nothing has been released yet. The repository is at `0.0.0`.

## [Unreleased]

### Added

- Password-protected PDF opening with an accessible retry dialog, user/owner authentication,
  encrypted search seeding, and AES-128/AES-256 preservation across full saves.
- Search next/previous controls, active match position, Enter/Shift+Enter and F3 traversal.
- Guarded existing-text replacement for unique, axis-aligned single-line ASCII runs, with
  exact surrounding-text and annotation postconditions inside the journal transaction and
  independent pdf.js/qpdf acceptance of the saved appearance.
- A static landing page at `/pdf/` and the mounted editor at `/pdf/app/`, deployed from the
  exact CI artifact through Vercel Build Output API v3, with separate landing-page size and
  zero-egress gates.

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
- Product specification draft: the five-label parity classification, a 312-item feature
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
- Serializable worker-side mutation port for annotations, page operations, form filling,
  metadata, AES password encryption, conservative sanitizing, wholesale page removal,
  full save/export, and MuPDF journal undo/redo.
- One command registry for the palette, platform shortcuts, disabled reasons, remapping, and
  preview-before-run automation pipelines.
- Worker-owned, feature-detected OPFS crash snapshots with debouncing, atomic generation
  rename, startup sweep primitives, and explicit degraded status when required APIs are absent.
- Document-first markup, comments, page organization, form, security, history, and disclosed
  overlay-entry panels.
- Independent pdf.js and qpdf acceptance tests for annotations, page mutations, failed-action
  rollback, one-step undo, and AES-256 encryption.
- ADRs 0021 through 0028 for the mutating port, command registry, Save semantics, redaction
  gating, active text entry, mounted deployment, and guarded existing-text replacement.
- Page composition workflows for drag reorder, exact insertion, extraction, replace, merge,
  duplicate, alternate/mix, named page boxes, labels, and split variants, all with result
  previews and journal undo.
- Interoperable markup families and properties: text markup, line and shape geometry, ink,
  clouds, built-in/dynamic/image stamps, file comments, measurements, reusable named tool
  sets, selection actions, and appearance regeneration.
- Sortable comment review with reply threads, review state, body editing, two-way navigation,
  and previewed FDF/XFDF import and export.
- AcroForm authoring for text, check, radio, choice, button, and signature fields; field
  positioning, resizing, alignment, distribution, tab order, isolated test mode, validation,
  and FDF/XFDF/XML/CSV value interchange.
- Worker-isolated MuJS for form keystroke, validation, calculation, and formatting actions;
  document-level scripts; an authoring console; and observable blocked external side effects.
- Local compare reports, native-browser OCR with pre-commit degradation disclosure, PDF/A
  conformance checks, Markdown export, Read Out Loud, accessibility checks and property repair,
  browser print preparation, and the registry-backed pipeline builder.

### Changed

- Content-stream editing, true redaction, existing object rewrites, and marked-content
  tagging were withdrawn after the null filter produced diffuse render perturbations.
- Save writes back only when the user opened through a Chromium File System Access handle;
  every other surface is named Download before invocation.
- The density control now uses Radix Select, platform shortcuts show Ctrl or Command correctly,
  and the empty state uses wide viewports as a two-column document-first introduction.

### Deprecated

### Removed

### Fixed

- Newly authored AcroForm fields now resolve `/Helv` through `/AcroForm/DR/Font` in
  independent readers instead of emitting a dangling default-appearance font name.
- Redaction character counts now use structured-text character callbacks rather than block
  separator-inflated text, and visual-only redactions no longer report that nothing changed.
- The capability panel now discloses the narrow verified Helvetica-overlay path and the
  document classes it refuses before mutation.

- Narrow global-toolbar tracks now shrink without overlapping labels.
- Development CSP transformation permits Vite HMR without changing the production CSP.
- Full garbage-collecting output is produced from an isolated reopened snapshot so saving
  cannot invalidate the active document's journal.
- The pinned qpdf bootstrap now serializes concurrent clean-host installation and replaces an
  incomplete cache atomically, avoiding missing-library and `ENOTEMPTY` oracle failures.
- Geometry-derived annotations no longer receive an invalid `/Rect` setter, so line, ink, and
  vertex markup use their native geometry without wrapper errors.
- Toolbar actions and recovery/error messages reflow without overlap at 320 px and 200% zoom.

### Security

- Default-deny Content Security Policy in `web/index.html`.
- PDF JavaScript has no browser network API; URL, email, submission, print, and menu requests
  are recorded for review and never performed.
- Decoded PDF JavaScript actions are capped before MuJS parses them; console evaluation uses a
  disposable snapshot and cannot mutate the open document.
- Updated ESLint's transitive `brace-expansion` dependency to the patched 5.0.8 release.
- Zero-egress proof in two layers: a static scan of the shipped bundle
  (`scripts/check-no-egress.mjs`) and a runtime assertion that the running application
  contacts no foreign origin (`tests/e2e/shell.e2e.ts`).
- Supply-chain denylist for `rustybuzz` (RUSTSEC-2026-0206), `ttf-parser`
  (RUSTSEC-2026-0192), and `rsa` (RUSTSEC-2023-0071), enforced by
  `scripts/check-supply-chain.mjs`.
