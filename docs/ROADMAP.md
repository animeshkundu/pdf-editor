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
done.

- [ ] **Vendor and build the MuPDF fork.** Fetch upstream, apply the patch set, build with
      Emscripten, produce `vendor/wasm-manifest.json`, and make
      `npm run check:wasm:fresh` pass in full mode.
      ([ADR 0004](adr/0004-fork-the-mupdf-wasm-build.md),
      [ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md))
      Partly done: `scripts/vendor-mupdf.mjs` fetches and patches, the stock from-source
      build reproduces Artifex's published artifact byte for byte, and `mujs=yes` builds
      and links. Remaining: the patch set itself, the manifest, and the freshness gate.
- [ ] **`js_processor` end to end.** Walk a real page's content stream from TypeScript and
      confirm `op_Tf` yields a resolved `pdf_font_desc`, `op_BDC` yields the cooked
      marked-content dictionary including the MCID, and `op_BI` yields a decoded image.
- [ ] **The encoding inversion.** The highest-risk item in the project. Build
      `invertEncoding()` and measure, across a corpus of real documents, how often Path A
      succeeds and where it fails. The answer defines what text editing can claim.
      ([ADR 0012](adr/0012-content-stream-text-editing.md))
- [ ] **The tiled render pipeline.** Prove that 512 px tiles keep scroll responsive on a
      heavy document and that superseded work is genuinely dropped.
      ([ADR 0010](adr/0010-tiled-render-pipeline.md))
- [ ] **Handle discipline under load.** Render several hundred pages and confirm the arena
      releases everything, with no growth across cycles.
      ([ADR 0009](adr/0009-wasm-memory-and-handle-discipline.md))
- [ ] **Worker crash and recovery.** Feed a fuzzed PDF until the instance traps, and
      confirm the document worker dies alone and recovers from OPFS.
      ([ADR 0008](adr/0008-worker-topology-and-crash-isolation.md),
      [ADR 0017](adr/0017-persistence-via-opfs.md))
- [ ] **iOS survival thresholds.** Measure where iOS Safari actually kills the tab and
      reconcile `IOS_BUDGET` against it. ([ADR 0014](adr/0014-resource-ceilings.md))
- [ ] **The oracles in CI.** pdf.js and qpdf wired in as acceptance readers, with a first
      test that fails when output is subtly wrong.
      ([ADR 0019](adr/0019-correctness-oracles.md))

## Phase 2: the product specification

- [ ] Write [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) from the spike findings.
- [ ] Reconcile every ADR against what the spikes actually showed. An ADR contradicted by
      evidence gets superseded, not quietly edited.

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

- [ ] OCR in the lazy worker.
- [ ] Accessibility repair: tag an untagged document.
- [ ] PDF/A conformance checking.
- [ ] Comparison view.

## Explicitly not planned

Server components of any kind, accounts, cloud storage, collaboration, telemetry,
analytics, LTV signatures, and a plugin ecosystem. See
[`VISION.md`](VISION.md#non-goals).
