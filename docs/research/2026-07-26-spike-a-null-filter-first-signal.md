# 2026-07-26 Spike A stage 1: the null filter, first signal

**Question.** If `pdf_filter_page_contents` is run with a filter specified to change
nothing, does the document survive unchanged? If a filter told to do nothing still
perturbs a page, content-stream rewriting cannot be the primary editing path, and
sixteen `OPEN` features including redaction and all in-place editing take their fallback.

**First signal: pass, on one real document.** All 19 pages filtered without error and
extracted text is identical on every page. This is not the verdict. See "What this is
not" below.

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
toolchain. **This is the first evidence that the fork strategy works end to end**: a C
function added to the shim, compiled, and callable. ADR 0004 rested on that being
straightforward, and it is.

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

## The unexpected finding: a null operation is not free

The output is **nearly double the input**: 146,453 bytes in, 289,731 out, for an
operation specified to change nothing.

The reason is structural rather than a defect. `pdf_filter_page_contents` rewrites each
page's content stream unconditionally, because it re-serialises the operator stream
through the sanitize filter rather than comparing and skipping. Under an incremental
save every rewritten stream is appended, and the originals remain in the earlier
revision, so the file carries two copies of every page's content.

Three consequences worth carrying forward:

1. **File growth is proportional to pages touched, not to the size of the edit.** Editing
   one word on one page of a 500-page document rewrites that page's stream and appends
   it. Editing something on every page roughly doubles the file. A user will notice.
2. **This compounds the C7 conflict already recorded in the specification.** Redaction
   already forces a full rewrite so the removed content does not survive in an earlier
   revision. This finding says the same pressure applies to ordinary edits for a
   different reason: not correctness, but size.
3. **A "did anything change" check cannot be based on stream identity**, because the
   stream always changes. Equivalence has to be judged on rendered output or extracted
   content, which is what acceptance criterion C4 already says. This is corroboration
   rather than news, but it is now measured rather than assumed.

## What this is not

**It is not the verdict, and it must not be quoted as one.**

- **MuPDF read its own output.** That violates the rule in
  [ADR 0019](../adr/0019-correctness-oracles.md) that the producer is never the
  acceptance reader. A smoke test using the producer answers "did this obviously destroy
  something", and it licenses the real comparison; it does not replace it. The verdict
  needs pdf.js rendering both files and diffing at 144 dpi.
- **One document is not a corpus.** `shared-mime-info-spec.pdf` is DocBook-produced with
  simple fonts and no tagging, optional content, transparency groups or CID fonts. It is
  close to the easiest case. The corpus named in the roadmap exists precisely so a pass
  means something, and this document would be one of its least demanding members.
- **Text extraction is a weak equivalence.** Identical extracted text is consistent with
  glyph positions having shifted, colours changing, or clipping being altered. Only a
  render comparison sees those.
- **Stage 2 is untouched.** A green stage 1 is necessary and not sufficient: this shows a
  round trip preserves a document told not to change, not that a rewrite which changes
  something is safe. A real edit perturbs resources, object numbering and stream lengths
  that the null case never touches.

## Where this leaves Spike A

Stage 1 has a first green signal on the easiest kind of document, and the substrate the
whole content-stream editing path depends on is demonstrably reachable and functioning.
That is a meaningful de-risking of ADR 0004 and ADR 0012.

The remaining work is unchanged in shape and now has a working harness to run it in:
assemble the corpus, run this same filter across it, and compare with pdf.js rather than
with MuPDF. The sixteen `OPEN` features stay `OPEN`.
