# Research

One Markdown file per entry, named `YYYY-MM-DD-slug.md`.

Examples:

- `2026-08-04-encoding-inversion-corpus.md`
- `2026-08-18-ios-safari-survival-thresholds.md`

Each entry includes:

- date and owner
- the research question, stated precisely enough to be answerable
- method: what was read, built, measured, or fuzzed
- findings, with confirmed facts separated from hypotheses and open questions
- citations. For repository findings, `file:line`. For external findings, a URL and the
  version or commit it describes.
- what this means for the product, and which ADR it supports, contradicts, or should
  produce
- links to related issues, pull requests, ADRs, plans, and follow-ups

Two standing rules for this project.

**Cite the source, not the documentation, for engine claims.** MuPDF's published reference
documents the union of the WebAssembly build and the `mutool run` interpreter, and a large
number of documented methods do not exist in the browser build. A claim about engine
capability is cited against `platform/wasm/lib/mupdf.c` at a specific version.

**Every Phase 1 spike in [`../ROADMAP.md`](../ROADMAP.md) ends with an entry here.** A
spike that produced working code but no written finding is not finished, because the
finding is what [`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) is assembled from.
