## Summary

<!-- What changed and why. Link the issue or the ROADMAP item. -->

## Which layer

<!-- This repository is three languages. Delete what does not apply. -->

- [ ] TypeScript (`lib/`, `entrypoints/`, `web/`)
- [ ] Rust (`crates/pdftext/`), fonts and text layout only, never touches the document
- [ ] C / Emscripten (`vendor/mupdf-wasm/`), the MuPDF fork
- [ ] Documentation, ADRs, or tooling only

## Decision records

<!-- Which ADRs this change operates under. Note any it contradicts; a contradicted ADR is
     superseded, not quietly edited. -->

## Verification

- [ ] `npm run check` passes (typecheck, lint, test, both JavaScript and Rust)
- [ ] `npm run build:web` succeeds, then `npm run check:egress` and `npm run check:size`
      pass against that fresh `dist/`
- [ ] `npm run check:supply` passes
- [ ] `npm run test:e2e` passes in Chromium and Firefox against the production build
- [ ] Drove the changed workflow in a real browser with a real PDF
- [ ] Checked in all three densities and both themes
- [ ] Keyboard-only operation verified; reduced motion actually exercised, not inferred

### If this change writes a document

- [ ] Output validated with **pdf.js or qpdf**, never with MuPDF (ADR 0019)
- [ ] Content-stream rewrites go through `pdf_filter_page_contents` with
      `pdf_new_sanitize_filter`
- [ ] Existing signatures still validate after an incremental save
- [ ] Marked content and structure-tree associations preserved

### If this change touches the engine or the Rust crate

- [ ] Rebuilt artifacts and a regenerated `vendor/wasm-manifest.json` are committed
- [ ] `npm run check:wasm:fresh` passes in **full** mode
- [ ] Engine capability verified against `platform/wasm/lib/mupdf.c`, not the published
      MuPDF reference

### If this change allocates

- [ ] Cost projected and asserted **before** mutation
- [ ] Every MuPDF handle wrapped in `arena.keep(...)` or `retain(key, ...)`
- [ ] Release happens in `finally`, in reverse order, on success, failure, and cancellation
- [ ] Any retained object has a named owner and an eviction policy
- [ ] Overflow-prone arithmetic uses `BigInt` and clamps

### If this change adds a dependency

- [ ] Exact-pinned, no range specifier
- [ ] Licence is AGPL-compatible, SPDX identifier recorded
- [ ] Not in the DENIED section of `docs/THIRD-PARTY.md`, transitively or otherwise
- [ ] Row added to `docs/THIRD-PARTY.md`

## Guardrails

- [ ] Zero egress preserved; CSP in `web/index.html` unchanged
- [ ] No positioned DOM text over the page
- [ ] Components reference semantic tokens only
- [ ] No planned capability described as shipped
- [ ] No attribution to generative or automated tooling anywhere in the diff, commits, or
      this description

## Notes

<!-- Screenshots, trade-offs, follow-ups, residual risks, and any verification gap you are
     leaving open. State gaps explicitly rather than omitting them. -->
