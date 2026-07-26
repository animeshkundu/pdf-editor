# 0005. A narrow Rust module for fonts and text layout only

## Status

Accepted

## Date

2026-07-26

## Context

Editing text in a PDF requires work MuPDF will not do for us. When a user retypes a
line, the new run has to be shaped (glyph selection, ligatures, kerning, mark
positioning), the embedded font may have to be re-subsetted to include glyphs the
original subset omitted, and mixed-direction runs have to be ordered correctly before
anything is written back.

MuPDF renders text with fonts that are already embedded. It has no interest in shaping
a new string against an arbitrary font, and no interest in writing a new subset.

The mature implementations of this work are in Rust: HarfBuzz ports for shaping, the
Fontations stack for parsing and writing, and a dedicated subsetter. Doing it in
TypeScript would mean writing a shaper, which is not a reasonable use of the project's
budget.

Two crates that would be the obvious picks are excluded:

- **`rustybuzz`** is subject to RUSTSEC-2026-0206: unmaintained. It is the best-known
  Rust HarfBuzz port and would be the default choice for anyone who does not check.
- **`ttf-parser`** is subject to RUSTSEC-2026-0192: unmaintained. It is a transitive
  dependency of a great deal of the Rust text ecosystem, so avoiding it constrains what
  else can be pulled in.

Both parse untrusted font data taken directly out of a user's PDF. An unmaintained
parser on an untrusted input path is not an acceptable risk in a tool whose whole claim
is safety.

## Decision

Add one small Rust crate, `crates/pdftext`, compiled to WebAssembly. Its scope is fonts
and text layout, and nothing else.

| Concern                | Crate                  | Why this one                                                                                |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| Shaping                | `harfrust`             | Maintained HarfBuzz port. Replaces `rustybuzz`.                                             |
| Font parsing           | `skrifa`, `read-fonts` | Fontations. Maintained by the Google Fonts team, actively developed, replaces `ttf-parser`. |
| Font writing           | `write-fonts`          | Same family, so parse and write share a model.                                              |
| Subsetting             | `subsetter`            | Produces a valid embeddable subset from a glyph set.                                        |
| Bidirectional ordering | `unicode-bidi`         | UAX #9 reordering before layout.                                                            |

Build with `wasm-bindgen-cli` plus `wasm-opt` directly. **Not `wasm-pack`**: it was
archived when the rustwasm organisation was sunset in July 2025, and building the
project on an archived tool is a maintenance liability with no upside, since
`wasm-bindgen-cli` is what `wasm-pack` was wrapping.

The exclusions are enforced, not merely documented. `scripts/check-supply-chain.mjs`
carries a `DENIED_CRATES` list covering `rustybuzz`, `ttf-parser`, and `rsa`, and fails
the build if any of them appears in `crates/pdftext/Cargo.lock`. It also runs
`cargo audit`, which is required to be available in CI. A routine dependency bump that
pulls one of these back in transitively will fail loudly rather than silently.

### Scope boundary

The Rust module is a pure function library over bytes. It **never touches the PDF
document**. It receives font bytes and a string, and returns glyphs, advances, and
subset bytes. It has no handle to a `pdf_document`, no ability to mutate, and no
knowledge of the object graph.

This boundary is load-bearing beyond tidiness: it is what makes MuPDF's own undo journal
sufficient (see [ADR 0011](0011-undo-on-the-mupdf-journal.md)). If two independent
modules could both mutate the document, a single journal could not describe the history,
and we would be forced to build a command stack on top. Keeping the Rust side pure
dissolves that problem entirely.

## Consequences

### Positive

- Correct shaping, subsetting, and bidirectional layout without writing any of it.
- Untrusted font parsing happens in maintained, memory-safe code.
- The purity boundary keeps the undo model simple.

### Negative

- A third toolchain in the build (see
  [ADR 0006](0006-three-toolchain-build-and-committed-wasm.md)).
- A second WASM module in the bundle budget.
- Avoiding `ttf-parser` restricts which other Rust text crates can be adopted later,
  since many depend on it.

### Neutral

- The denylist can be revisited if either crate returns to maintenance, but only through
  a superseding ADR. `check-supply-chain.mjs` requires exactly that.

## Notes

Enforced by `scripts/check-supply-chain.mjs`. Recorded in the DENIED section of
[`../THIRD-PARTY.md`](../THIRD-PARTY.md). The Rust build entry point is
`scripts/cargo.mjs`, which degrades cleanly when the crate or the toolchain is absent so
that the `lint` and `test` pipeline gates exist from the first commit.
