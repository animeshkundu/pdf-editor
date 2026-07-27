# 0012. Content-stream text editing: two paths, chosen at commit time

## Status

Superseded by [ADR 0020](0020-content-stream-rewriting-failed-stage-one.md)

## Date

2026-07-26

## Context

Editing existing text in a PDF is the capability users most want and the one almost no
browser tool provides, because a PDF does not contain text in any editable sense. It
contains a content stream of positioning and show-text operators, where the operands are
byte strings interpreted through whatever encoding the embedded font declares. Changing
a word means finding which bytes produced it, deciding what bytes should replace it, and
rewriting the stream without disturbing anything else.

The read side is handled by the fork. `js_processor`
([ADR 0004](0004-fork-the-mupdf-wasm-build.md)) delivers each operator with MuPDF's own
resolution already applied: `op_Tf` yields a resolved `pdf_font_desc`, so the encoding
tables, descendant font, and CID mapping are loaded rather than left as a raw name to
chase through the object graph.

The write side splits on one question: **can the new string be expressed in the font
that is already embedded?**

Answering it requires inverting the font's encoding, that is, going from a Unicode
codepoint back to the character code the embedded font would use for it. That inversion
has to reconcile several structures that can disagree:

- `/Encoding`, including a base encoding plus a `/Differences` array that remaps
  individual codes.
- `/ToUnicode`, a CMap that maps codes to Unicode, in the direction opposite to the one
  we need, and which is frequently incomplete or wrong because producers treat it as
  advisory.
- `/W` and `/DW`, the CID width arrays, which determine advances and therefore whether
  the replacement will fit the original layout.
- `/CIDToGIDMap`, which may be `/Identity` or a stream, and which stands between a CID
  and an actual glyph.

**No library in any language does this inversion.** Every implementation we surveyed
goes the other way, from code to Unicode, because that is what extraction needs. This is
the single largest remaining technical risk in the product and is the subject of a
dedicated de-risking spike before the product specification is written
([`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md)).

## Decision

Text editing has two commit paths, and the path is selected **at commit time by
attempting the inversion**, never predicted in advance.

### Path A: in-place, reusing the embedded font

Taken when every character of the replacement string inverts successfully to a code in
the existing embedded font.

The show-text operand is rewritten with the inverted codes and the content stream is
rewritten through `pdf_filter_page_contents` with `pdf_new_sanitize_filter`, so
operators we did not touch pass through byte-identical. No font is added, no resource
dictionary changes, and the rendered result uses exactly the glyphs the document already
carried.

This is the path that preserves appearance perfectly, and it is the one to prefer
whenever it is available.

### Path B: reshape and re-embed a subset

Taken when inversion fails for any character, which happens whenever the replacement
introduces a glyph the original subset does not contain. This is common: producers embed
only the glyphs a document actually used, so typing a `Q` into a document that never
contained one will usually miss.

The string is shaped by the Rust module ([ADR 0005](0005-rust-font-module-scope.md)),
a new subset is produced covering the required glyphs, the subset is embedded, a new font
resource is added to the page, and the content stream is rewritten to reference it.

### The selector

`invertEncoding()` returns either a complete code sequence or the index of the first
character it could not map. Path A runs on success, Path B on failure. There is no
heuristic, no confidence score, and no configuration flag: the availability of Path A is
a fact about the document and the string, and it is determined by trying it.

Deciding earlier is what makes this hard to get right. A pre-flight guess based on the
font subtype, the presence of `/ToUnicode`, or a character-range check is exactly the
kind of approximation that produces a wrong glyph in a signed contract.

### Invariants for both paths

- The whole edit is one journal operation
  ([ADR 0011](0011-undo-on-the-mupdf-journal.md)). Rewriting the stream, embedding the
  subset, and updating the resource dictionary either all land or none do.
- Rewrites go through `pdf_filter_page_contents`. Hand-assembling a content stream is
  forbidden: it loses graphics state, clipping, transparency groups, and optional
  content in ways that are invisible until a specific viewer renders it.
- Marked content is preserved. `op_BDC` gives us the cooked dictionary including the
  MCID, so an edit inside a tagged region keeps its structure-tree association rather
  than silently untagging the document.
- Correctness is judged by an independent reader, never by MuPDF
  ([ADR 0019](0019-correctness-oracles.md)).

## Consequences

### Positive

- The common case preserves the document's own glyphs exactly, which is what a user
  editing a contract actually needs.
- The uncommon case still works rather than refusing the edit.
- The two paths differ in what they add to the document, not in the guarantees they make
  about the rest of it.

### Negative

- The inversion is bespoke, load-bearing, and has no reference implementation to check
  against. It needs an unusually thorough test corpus.
- Path B grows the document and can change rendered appearance subtly, since a
  re-embedded subset of a different font is not the same as the original.
- Some documents will support neither path cleanly (Type 3 fonts, fonts with no usable
  encoding at all). Those must be detected and refused with an honest explanation, not
  edited approximately.

### Neutral

- Which path was taken is worth surfacing to the user, because it is the difference
  between "your document is unchanged apart from the words" and "a font was added".

## Notes

Depends on [ADR 0004](0004-fork-the-mupdf-wasm-build.md) for the processor and the
filter, [ADR 0005](0005-rust-font-module-scope.md) for shaping and subsetting, and
[ADR 0019](0019-correctness-oracles.md) for acceptance. The scope of what this product
promises about text editing is deliberately not fixed until the inversion spike reports.
