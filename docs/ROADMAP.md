# Roadmap

The order below is deliberate. The spikes come first because their results determine what
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) can honestly promise, and promising before knowing is
the failure this project most wants to avoid.

Scope changes require a superseding ADR. Nothing here may weaken the privacy posture, the
browser floor, the resource ceilings, the accessibility target, or the oracle rule.

## Phase 0: foundation

Complete.

- [x] Repository, build, lint, test, and formatting configuration.
- [x] Resource ceilings (`lib/core/limits.ts`) with boundary tests.
- [x] Design token system with three densities and two themes.
- [x] Structural editor shell with landmarks and a skip link.
- [x] Nine gate scripts: egress, WASM freshness, supply chain, bundle size, spec
      integrity, handle leak, cargo deny, deployment, and performance baseline.
- [x] Five workflows: CI, WASM, deployment check, nightly performance, release.
- [x] CI running the full gate set on every pull request, green on a self-hosted runner
      including both Playwright browsers.
- [x] Documentation set and ADRs 0001 through 0019.
- [x] MuPDF vendored, with the stock from-source build reproducing Artifex's published
      artifact byte for byte
      ([ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md)).

## Phase 0b: the specification

Not in the original plan. It grew out of Phase 0 because the parity contract turned out to
be the artifact the build pipeline consumes, and writing it surfaced three engine problems
that no amount of planning had found.

- [x] [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) partial draft: the five-label classification,
      the spike decision rules, and the acceptance criteria.
- [x] [`spec/parity-inventory.md`](spec/parity-inventory.md): 311 features, each with a
      stable identifier and a label, gated by `scripts/check-spec-integrity.mjs`.
- [x] [`spec/competitor-wins.md`](spec/competitor-wins.md) and
      [`spec/ui-ux.md`](spec/ui-ux.md).
- [x] [`spec/a11y-rules.md`](spec/a11y-rules.md): all 32 accessibility rules, each with its
      check, verdicts, message, fixture and repair. This unblocked `A11Y-001` to
      `A11Y-032`, which were previously identifiers with no buildable definition.
- [ ] The remaining section of `PRODUCT-SPEC.md`, text-editing depth, which Spikes A and B
      decide.

## Phase 1: de-risking spikes

Each spike ends with a written finding under [`research/`](research/) using the
`YYYY-MM-DD-slug.md` convention. A spike that produces working code but no finding is not
done, because the finding is what
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) is assembled from.

**The letters are the join.** `PRODUCT-SPEC.md` and
[`spec/parity-inventory.md`](spec/parity-inventory.md) name these spikes A through E, and
every `OPEN` feature cites one. The decision rules, the shared corpus, and what each
outcome promotes or withdraws are in
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md#the-corpus). This roadmap says when they happen; that
document says what counts as an answer.

Eighteen features are `OPEN` across the five.

### Spike A: content-stream rewriting

The largest block. It gates text editing, image editing, redaction, half of optimize, and
marked-content tagging, because all of them go through the same filter.

- [ ] **Vendor and build the MuPDF fork.** Apply the patch set, produce
      `vendor/wasm-manifest.json`, and make `npm run check:wasm:fresh` pass in full mode.
      ([ADR 0004](adr/0004-fork-the-mupdf-wasm-build.md),
      [ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md))
      Partly done: `scripts/vendor-mupdf.mjs` fetches and patches, the stock build
      reproduces Artifex's artifact byte for byte, and `mujs=yes` builds and links at a
      cost of 240,327 bytes. Remaining: the patch set itself, the manifest, and the
      freshness gate in full mode.
- [ ] **`js_processor` end to end.** Walk a real page's content stream from TypeScript and
      confirm `op_Tf` yields a resolved `pdf_font_desc`, `op_BDC` yields the cooked
      marked-content dictionary including the MCID, and `op_BI` yields a decoded image.
      Prerequisite for the spike proper.
- [ ] **Assemble the corpus.** Eight or more producers, simple and CID fonts, subsetted and
      full embeddings, a Type 3, tagged and untagged, OCGs and transparency groups, RTL and
      CJK, linearised and not, and one document MuPDF repairs on open. Fixed before any
      spike runs, and shared with acceptance criteria C1, C2, C5, C8 and R5.
- [ ] **Spike A stage 1: the null filter.** Run a pass-through filter specified to change
      nothing across the corpus and compare with the oracles. Green, conditional or red,
      per the decision table.
- [ ] **Spike A stage 2: a non-null rewrite.** A green stage 1 is necessary but **not
      sufficient**: a null filter proves the round trip preserves a document told not to
      change, not that a rewrite which changes something is safe. Stage 2 replaces one word
      and deletes one run, then inspects every changed page for collateral damage.
      Promotion needs both stages, reported separately.

### Spike B: the encoding-inversion hit rate

- [ ] **Build `invertEncoding()` and measure.** Across the corpus, per font type, how often
      every character of a run inverts against the embedded font. No library in any language
      does this, so there is no prior art to borrow a number from.
      ([ADR 0012](adr/0012-content-stream-text-editing.md))
      The rate decides what shipped copy says rather than whether text editing ships, since
      Path B is a working fallback. Two results withdraw a capability regardless: a font
      class where inversion silently produces the **wrong glyph**, and fonts with no usable
      encoding.

### Spike C: the synchronous signer bridge

**The one that may have no solution, and the most serious risk in the project after the
encoding inversion.** Blocks `SIGN-005`, `SIGN-006`, `SIGN-008` and part of `SIGN-007`.

- [ ] **Prove the bridge, or fail the design.** `pdf_pkcs7_signer.create_digest` is
      synchronous: it returns `int` and writes into a caller-supplied buffer
      (`include/mupdf/pdf/form.h:226`). `SubtleCrypto` is asynchronous. The engine is
      single-threaded WASM with no pthreads, so there is no thread to block and no
      `Atomics.wait` to use. The C comment above that typedef says the callback creates
      "a signature", not a digest, so the whole CMS operation may need to complete
      synchronously.
      [ADR 0018](adr/0018-signing-via-custom-signer-vtable.md) rests entirely on this
      bridge and its `## Unresolved` section lists four candidate resolutions, none
      demonstrated: Asyncify, JSPI, precomputing the digest, and splitting hash from sign
      at the vtable boundary.
      **If none works, ADR 0018 is superseded rather than amended**, and signing is
      withdrawn or redesigned. This spike should run early: it is cheap to attempt and
      expensive to discover late.

### Spike D: the verifier bridge

Blocks `SIGN-010`. Inherits Spike C's synchrony problem, since verifier callbacks are
equally synchronous.

- [ ] **Add a `pdf_pkcs7_verifier` to the shim.** The WASM build exports no verification
      surface at all: `pdf_check_digest` and `pdf_check_certificate` exist in the C API
      (`form.h:268-269`) and `pdf_pkcs7_verifier` is a four-function vtable
      (`form.h:244-250`), but grepping the shim for `pkcs7` or `signer` returns nothing.
      When it ships it reports six separate statuses rather than one verdict.

### Spike E: the public-key security handler

Blocks `SIGN-026`.

- [ ] **Show two-way interoperability with Acrobat.** A document we encrypt to a recipient
      list opens in Acrobat, and one Acrobat encrypts opens in ours. PDF's public-key
      security handler is a specific construction rather than something WebCrypto plus a
      certificate parser provides. **If interoperability cannot be shown, this becomes
      `EXCLUDED`** rather than shipping a format only we can read.

### Independent of the spikes

These de-risk the runtime rather than the engine surface, and can run in parallel.

- [ ] **The tiled render pipeline.** Prove that 512 px tiles keep scroll responsive on a
      heavy document and that superseded work is genuinely dropped.
      ([ADR 0010](adr/0010-tiled-render-pipeline.md))
- [ ] **Handle discipline under load.** Render several hundred pages and confirm the arena
      releases everything, with no growth across cycles. This is acceptance criterion R3,
      which was rewritten to be intra-session: the failure that kills the product is a few
      MB leaked per edit across a multi-hour session.
      ([ADR 0009](adr/0009-wasm-memory-and-handle-discipline.md))
- [ ] **Worker crash and recovery.** Feed a fuzzed PDF until the instance traps, and confirm
      the document worker dies alone and recovers from OPFS, including the startup sweep
      that collects entries a crashed session left behind.
      ([ADR 0008](adr/0008-worker-topology-and-crash-isolation.md),
      [ADR 0017](adr/0017-persistence-via-opfs.md))
- [ ] **iOS survival thresholds.** Measure where iOS Safari actually kills the tab and
      reconcile `IOS_BUDGET` against it. ([ADR 0014](adr/0014-resource-ceilings.md))
- [ ] **The oracles in CI.** pdf.js and qpdf wired in as acceptance readers, with a first
      test that fails when output is subtly wrong. Every other spike's verdict depends on
      these, so they come first in practice.
      ([ADR 0019](adr/0019-correctness-oracles.md))

## Phase 2: close the specification

Most of the specification moved earlier, into Phase 0b, because it turned out to be
buildable without the spikes and because writing it found three engine problems that
planning had not. What is left genuinely depends on results.

- [ ] Write the text-editing depth section of
      [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md#open-text-editing-depth) from the Spike A and B
      findings, and promote or withdraw the eighteen `OPEN` items accordingly.
- [ ] Reconcile every ADR against what the spikes actually showed. An ADR contradicted by
      evidence gets **superseded, not quietly edited**. ADR 0018 is the likeliest
      candidate, on Spike C.
- [ ] Re-run the self-critique pass over the inventory once the labels move, since a
      promotion is exactly when optimism creeps back in.

## Phase 3: viewer

- [ ] Open, render, navigate, zoom, and search a document.
- [ ] Text selection and copy from `stext` quads, with the canvas highlight overlay.
      ([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md))
- [ ] Logical reading order for assistive technology, and Ctrl+F routed to engine search.
- [ ] Thumbnails, outline, and attachments.
- [ ] Command palette.

## Phase 4: editor

- [ ] Page operations: reorder, rotate, insert, delete, extract, merge, split.
- [ ] Annotations: highlight, note, ink, shapes, stamps.
- [ ] Form filling, including AcroForm JavaScript through `mujs=yes`.
- [ ] Text editing, on whichever paths the spike showed to be honest.
      ([ADR 0012](adr/0012-content-stream-text-editing.md))
- [ ] Redaction that removes content from the stream rather than covering it.
- [ ] Signing. ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md))

## Phase 5: beyond

- [ ] OCR in the lazy worker (`CONV-017`, `DEGRADED`).
- [ ] Accessibility repair: tag an untagged document. Blocked on Spike A, and it is the
      repair for `A11Y-003`, the rule that fires on every untagged document.
- [ ] PDF/A conversion and validation (`CONV-023`, `CONV-024`).
- [ ] Comparison view (`CMPR-001` to `CMPR-009`).

## A note on the inventory and this file

[`spec/parity-inventory.md`](spec/parity-inventory.md) lists 311 features. This roadmap
lists a handful of phases. They are different documents doing different jobs, and the
difference is deliberate: the inventory says what "done" means for each feature when its
turn comes, and this file says what order the turns are in.

Neither is a schedule. The inventory is explicit that 311 items is a multi-year contract
rather than a release plan, and that a viewer doing its first three sections properly is
worth shipping.

## Explicitly not planned

Server components of any kind, accounts, cloud storage, collaboration, telemetry,
analytics, LTV signatures, and a plugin ecosystem. See
[`VISION.md`](VISION.md#non-goals).
