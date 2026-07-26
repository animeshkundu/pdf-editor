# 2026-07-26 Spike A stage 1: the null filter, first signal

**Question.** If `pdf_filter_page_contents` is run with a filter specified to change
nothing, does the document survive unchanged? If a filter told to do nothing still
perturbs a page, content-stream rewriting cannot be the primary editing path, and
sixteen `OPEN` features including redaction and all in-place editing take their fallback.

**First signal, stated narrowly: MuPDF accepted its own incrementally saved output for
one simple document, and its extractor returned the same text strings.** Visual
equivalence, external compatibility and growth causality are all untested.

That is weaker than this document originally claimed. The first version said "the fork
strategy works end to end", which a reader scanning conclusions could take as an
implementation go-signal. It is not one. What is established is that the shim invoked
the API on this document and MuPDF subsequently accepted its own output.

## What was built

The forked shim gained one export, which is the whole of the C written so far:

```c
EXPORT
void wasm_pdf_null_filter_page(pdf_page *page)
{
	pdf_filter_options filter_opts = { 0 };
	pdf_sanitize_filter_options sanitize_opts = { 0 };
	pdf_filter_factory factories[2] = { { 0 } };

	factories[0].filter = pdf_new_sanitize_filter;
	factories[0].options = &sanitize_opts;

	filter_opts.recurse = 1;      /* descend into Form XObjects */
	filter_opts.newlines = 1;
	filter_opts.filters = factories;

	TRY({ pdf_filter_page_contents(ctx, page->doc, page, &filter_opts); })
}
```

Thirty-six lines appended to `platform/wasm/lib/mupdf.c`, built clean with the existing
toolchain. What that establishes is narrow but real: **a C function can be added to the
shim, compiled and called from JavaScript.** ADR 0004 assumed that was straightforward
and it is. It says nothing about whether what the function does is correct.

## Result

```
input: shared-mime-info-spec.pdf  146,453 bytes
pages: 19
filtered: 19/19 ok, 0 failed
output 289,731 bytes, delta 143,278
pages after: 19

extracted text identical on 19/19 pages
```

The document opens, keeps its page count, and every page's extracted text is byte-equal
to what it was before filtering.

## Correction: the doubling was mostly the save mode, not the filter

**The first version of this finding got this wrong, and the error is instructive.**

It reported that output was 289,731 bytes against 146,453 in, attributed the near-doubling
to the filter re-serialising every content stream, and concluded that "file growth tracks
pages touched rather than the size of the edit" so that "editing one word on every page
roughly doubles it".

That conclusion was drawn from a single measurement with two variables changing at once:
the filter ran, **and** the save was incremental. Isolating them:

| Case                             |   Bytes | Ratio |
| -------------------------------- | ------: | ----: |
| Input                            | 146,453 | 1.00x |
| No filter, incremental save      | 146,453 | 1.00x |
| No filter, full save + compress  | 196,133 | 1.34x |
| Filtered, incremental save       | 289,731 | 1.98x |
| Filtered, full save + compress   | 198,202 | 1.35x |
| Filtered, full save, no compress | 303,872 | 2.07x |

**Filtering every page of the document costs 2,069 bytes, about one percent**, when the
result is saved the way a real save would be. 198,202 against an unfiltered full save of
196,133. The near-doubling was an artifact of incremental save retaining both the
original and the rewritten stream, and of the re-serialised streams being uncompressed
when compression was off.

Two things that are actually true, replacing the claim that was not:

1. **Filtering is close to free on a full compressed save.** The re-serialised stream
   compresses to about what the original did, which is unsurprising once stated: the
   operators are equivalent, so the entropy is similar.
2. **A full save costs 34% over the original file regardless of filtering**, because
   MuPDF's writer packs less tightly than whatever produced this document. That is a
   property of the writer and would apply to any save, filtered or not. It is worth
   knowing and has nothing to do with content-stream rewriting.

The original claim survives in one narrow form: under **incremental** save specifically,
a filtered page does carry two copies. That is a reason to prefer a full save after
editing, which the specification already requires for redaction on correctness grounds.
It is not the general cost claim that was published.

**Why this happened, since it is the same failure this project keeps finding elsewhere.**
One measurement, two variables, and a mechanism that sounded right was accepted without a
control. The control took four minutes and reversed the conclusion. The mechanism was not
wrong about what the filter does; it was wrong about how much that matters, which is a
harder error to notice because the reasoning is sound and only the magnitude is invented.

## What this is not

**It is not the verdict, and it must not be quoted as one.**

- **MuPDF read its own output.** That violates the rule in
  [ADR 0019](../adr/0019-correctness-oracles.md) that the producer is never the
  acceptance reader. Producer and oracle here share a parser and its bugs, so this
  answers "did MuPDF accept MuPDF's output", which is a weaker question than it looks.
- **"Extracted text identical" is a narrow signal.** It catches dropped, reordered or
  changed characters that this extractor can see. All of the following can be badly
  broken while producing the same strings: text matrices, glyph positions, spacing,
  rotation and clipping; which glyph is drawn despite an unchanged Unicode mapping; text
  rendered off-page or beneath other content; fonts and resource references; images,
  paths, colours, transparency, blend modes and z-order; Form XObjects and shared
  resources; optional-content visibility; annotations, forms, links and actions; tags,
  structure trees and reading order; and syntax MuPDF tolerates that another reader
  rejects.
- **This is not a byte-level null operation.** A sanitize filter with `recurse=1` and
  `newlines=1` deliberately parses and re-serialises, rewrites nested streams, and
  inserts formatting. It is a semantic-null serialiser test at most.
- **One document is not a corpus.** `shared-mime-info-spec.pdf` is DocBook-produced with
  simple fonts and no tagging, optional content, transparency groups or CID fonts. It is
  close to the easiest case, and would be one of the least demanding members of the
  corpus the roadmap names.
- **Stage 2 is untouched.** A green stage 1 is necessary and not sufficient: this shows a
  round trip preserves a document told not to change, not that a rewrite which changes
  something is safe. A real edit perturbs resources, object numbering and stream lengths
  the null case never touches.

**Most likely way this turns out wrong:** a more complex document renders differently in
pdf.js, through graphics state, clipping, fonts or shared resources, while MuPDF's
extractor keeps returning the same character sequence and reports nothing.

## Where this leaves Spike A

Two things are established. The filter API is reachable from the shim and returns without
error on 19 real pages, and filtering costs about one percent on a full compressed save.
Neither is a fidelity result.

Nothing is de-risked about ADR 0012, which is the one that matters, because no independent
reader has looked at the output. The value delivered here is a **working harness**: the
export exists, the patch is captured, and the loop from PDF to filtered output runs in
about a second. Pointing it at the corpus and at pdf.js is now configuration rather than
construction.

The sixteen `OPEN` features stay `OPEN`, and stage 1 is not yet passed. It has one
encouraging data point from the easiest available document, judged by the wrong reader.
