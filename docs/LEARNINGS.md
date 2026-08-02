# Learnings

Durable findings, so future work does not rediscover them. Add an entry when something
cost real time to learn, especially when the obvious answer turned out to be wrong.

Use `## YYYY-MM-DD: short statement of the lesson`, then context, what happened, and what
to do next time.

## Current repository facts

- Repository: `animeshkundu/pdf-editor` (private).
- Licence: AGPL-3.0-only, which follows from MuPDF
  ([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).
- Three languages: C with Emscripten (the MuPDF fork), Rust with `wasm32-unknown-unknown`
  (`crates/pdftext`), and TypeScript (everything else).
- Node 22.13 or newer. Gate: `npm run check` (typecheck, lint, test). Additional gates:
  `check:egress`, `check:size`, `check:supply`, `check:wasm:fresh`.
- Development happens on Windows; CI runs on Linux. `.gitattributes` normalises line
  endings to LF because the WASM freshness gate compares bytes.

## 2026-08-01: preserve bytes instead of improving a semantic reserializer

- **Context.** The sanitize filter perturbed rendering even when asked to change nothing.
- **What happened.** A tokenizer and byte splicer can prove a different property: every byte
  outside explicit ranges is copied unchanged. A forced null write, a real replacement, and a
  deliberately corrupted span distinguish a working path from a vacuous pass.
- **What to do next time.** When fidelity depends on untouched syntax, retain token spans and
  splice only verified ranges. Require a failing negative control, reread the written object,
  keep the write inside one journal operation, and grade saved output with pdf.js and qpdf.

## 2026-08-01: test the complete patched tree before replaying individual patches

- **Context.** `vendor-mupdf.mjs` used reverse-apply checks to make patch replay idempotent.
- **What happened.** A later patch can alter context used by an earlier patch, causing the
  reverse check to fail even though every patch is already present. The script then tries to
  apply the earlier patch and fails.
- **What to do next time.** First compare all expected patched-file digests in one pass. If the
  complete tree matches, skip replay and regenerate the source stamp. Use per-patch reverse
  checks only to resume a genuinely partial patch sequence.

## 2026-08-01: an installed emsdk need not be an activated emsdk

- **Context.** The exact Emscripten 4.0.8 compiler existed under `/tmp/emsdk`, but
  `emsdk_env.sh` did not add it to `PATH`; reinstalling failed while chmod-ing Node symlinks.
- **What happened.** Probing only `emcc` after sourcing treated the installed compiler as
  absent. The build repeatedly entered a broken installer despite a working compiler.
- **What to do next time.** Probe the pinned compiler at
  `$EMSDK/upstream/emscripten/emcc`, add its directories to `PATH`, set `EM_CONFIG` and
  `EMSDK_NODE`, and install only when that exact compiler is genuinely absent.

## 2026-08-01: a UI sweep is evidence, not a capability claim

- **Context.** Recording shell accessibility, responsive behaviour, and document-dependent
  states across fixtures with uneven engine support.
- **What happened.** A root-preview observation can establish a visible shell state, but it
  does not establish that the mounted production artifact can reach that state. Several
  important PDF states also require fixtures or engine signals that are not presently
  available.
- **What to do next time.** Record the reach route, fixture, matrix, and evidence source for
  every sweep row. Mark a state `ENGINE-BLOCKED` when the fixture or signal is absent; do not
  turn it into a passing claim. Reserve production-artifact evidence for a run that actually
  uses that artifact.

## 2026-08-01: visible coverage can still be vacuous

- **Context.** Browser coverage asserted designed controls, keyboard selection, and local print.
- **What happened.** A native-control query ran only after every panel had closed, an overlay
  assertion checked an always-present transparent canvas, and `noopener` made `window.open`
  return no usable print handle. All three looked covered until the assertions exercised the
  actual rendered state and output navigation.
- **What to do next time.** Keep assertions inside the mounted surface, inspect painted canvas
  alpha rather than element presence, operate portalled controls, and wait for the generated
  blob request. A browser path is covered only when its final side effect is observed.

## 2026-07-30: verify the dangerous half of a compound mutation before commit

- **Context.** Existing-text replacement removes source glyphs before adding its replacement.
- **What happened.** A broad CJK path reported success after removal even though the
  replacement never reached an independent reader. Preflight font checks could not protect
  the failure between those two steps.
- **What to do next time.** Keep the path narrow enough to prove: unique axis-aligned text,
  no ambiguous document structures or overlapping annotations, and a replacement that fits a
  standard-font appearance. Inside the same journal operation, assert that only the selected
  structured characters disappeared, the prior annotation set is identical, and the exact
  replacement appearance exists. Throw before `endOperation()` on any mismatch so the
  journal abandons both halves. Grade the saved output separately with pdf.js and qpdf.

## 2026-07-30: public rewrites must follow internal-mount redirects

- **Context.** Publishing a landing page at `/pdf/` and an app with assets baked for
  `/pdf-editor/app/`.
- **What happened.** A public rewrite makes the request eligible for later route matches. If
  the internal mount redirect comes later, `/pdf/` rewrites to `/pdf-editor/` and redirects
  back to `/pdf/` forever.
- **What to do next time.** Put security headers first, internal mount redirects before
  public rewrites, and the filesystem handler last. Extract the app CSP from the built HTML,
  then append the header-only `frame-ancestors` directive instead of maintaining a second
  policy string.

## 2026-07-28: MuJS support and observable events are separate WASM surfaces

- **Context.** Enabling Acrobat-compatible form scripts in the browser build.
- **What happened.** `mujs=yes` made `pdf_enable_js` functional, but the committed high-level
  wrapper still threw from `setJSEventListener`, and the shim had no console-execution export.
  Runtime support therefore remained unobservable even though the interpreter linked.
- **What to do next time.** Prove all three layers: enable MuJS, bridge `pdf_doc_event_cb` and
  `pdf_js_console` into the worker, and export bounded `pdf_js_execute`. Install the console
  before startup actions, cap decoded action streams natively before parsing, reserve MuJS
  memory even when scripts only mutate globals, and evaluate console input on a disposable
  snapshot with startup scripts removed. Keep external URL, mail, submit, print, and menu
  requests as serializable observations; never honor them.

## 2026-07-28: qpdf test setup is a shared installation transaction

- **Context.** Several Vitest files independently ask the pinned qpdf bootstrap for the
  executable path during parallel suite startup.
- **What happened.** Each process could delete and replace the same cache directory while
  another process was loading its bundled libraries. That produced both a missing
  `libunistring.so.2` at execution time and an `ENOTEMPTY` cleanup race.
- **What to do next time.** Treat tool bootstrap as a cross-process transaction: test the
  binary and bundled libraries, acquire a directory lock, stage beside the destination, and
  atomically rename. Re-check readiness while waiting so only one process downloads.

## 2026-07-28: raw PDF strings are not JavaScript strings

- **Context.** Creating an AcroForm Widget through the exported raw object graph.
- **What happened.** Passing a JavaScript string directly to `PDFObject.put()` produced a PDF
  name (`/full_name`) rather than a PDF string (`(full_name)`). pdf.js could interpret the
  saved experiment only when `/T`, `/TU`, `/V`, `/DV`, `/DA`, and choice options were created
  explicitly with `newString()`.
- **What to do next time.** Use `newName()` only for enum-like PDF names such as `/Tx` and
  `/Off`; use `newString()` for human text and field values. Verify authoring with
  `pdf.js.getFieldObjects()` before relying on MuPDF's Widget accessor cache.

## 2026-07-27: `new PDFDocument(existing)` retains the same native document

- **Context.** Producing a full garbage-collecting output without disturbing the active
  journal.
- **What happened.** The wrapper constructor looks like a clone API, but its implementation
  keeps the same native pointer. Garbage collection through that second wrapper renumbered
  the active object graph, and a later undo retained an inserted page even though the journal
  position moved back.
- **What to do next time.** Stage a plain full buffer, reopen those bytes as an independent
  document, and run garbage collection or encryption only on that independent instance.
  Test page count and order again after save-then-undo; annotation-only coverage does not
  expose page-tree aliasing.

## 2026-07-27: worker configuration must run before the engine chunk

- **Context.** Keeping Emscripten's diagnostic stderr visible without turning expected MuPDF
  cache-invalidation diagnostics into browser `console.error` failures.
- **What happened.** A side-effect import beside static MuPDF imports ran too late because the
  engine chunk was evaluated with the worker dependency graph. The module configuration hook
  had already been consumed.
- **What to do next time.** Use a tiny worker bootstrap that installs worker-local module
  configuration and only then dynamically imports the runtime that depends on MuPDF.
  Operation failures still travel through typed WorkerRpc rejection; diagnostic stderr is a
  warning stream.

## 2026-07-27: module workers need an explicit ready handshake

- **Context.** Sending an `open` request immediately after constructing the production
  MuPDF document worker.
- **What happened.** The worker fetched and initialized the WASM successfully, but a request
  posted before the module finished evaluating and installed its message listener was lost
  in the browser runtime. The UI stayed in its loading state with no error to report.
- **What to do next time.** Have every module worker post an id-zero ready response after
  installing its listener. Queue RPC messages behind that handshake and fail startup after
  a bounded deadline. Worker creation is not evidence that worker code is listening.

## 2026-07-27: virtual document height cannot be a CSS spacer

- **Context.** Mapping the 10,000-page ceiling into one prefix-sum scroll surface.
- **What happened.** Browser layout dimensions clamp well below the logical height of a
  permitted document at supported zoom levels, making later pages unreachable.
- **What to do next time.** Keep the prefix sum in logical coordinates, cap physical scroll
  height, map between the two ranges, and position only the mounted page window near the
  current physical scroll offset.

## 2026-07-27: transferred input still has a WASM copy cost

- **Context.** Opening the same maximum-size file in document and search workers.
- **What happened.** Slicing twice before transfer and opening both workers concurrently
  multiplied one accepted file into several simultaneous JavaScript and WASM copies.
- **What to do next time.** Transfer the original buffer directly, start the read-only search
  worker lazily, and project the aggregate input-plus-WASM peak before allocating it.

## 2026-07-27: tagged structure is not exposed by the committed wrapper

- **Context.** Building the hidden assistive reading surface from structured text.
- **What happened.** The engine can collect structure internally, but the committed
  `StructuredText.walk()` wrapper ignores structure blocks and exposes no traversal API.
- **What to do next time.** Detect tagged pages and disclose inferred order as `DEGRADED`;
  do not call it structure-tree order until a measured wrapper export exists.

## 2026-07-26: MuPDF's published docs describe a superset of the WASM build

- **Context.** Planning the engine layer against the MuPDF reference on readthedocs.
- **What happened.** That reference documents the union of two different surfaces: the
  WebAssembly build and the `mutool run` desktop JavaScript interpreter. A large number of
  documented methods are marked `[mutool run only]` and simply do not exist in the browser
  build. A design derived from the documentation fails at first integration.
- **What to do next time.** Verify every engine capability against
  `platform/wasm/lib/mupdf.c` in the actual version being used. The shim is small (2,944
  lines, 331 unique `wasm_` symbols) and reading it is faster than debugging a wrong
  assumption. Grepping it for `filter|processor|sanitiz|clip_page` returns nothing, which
  is how we know the content-stream machinery is genuinely unexported rather than merely
  undocumented. This is how ADR 0004 was written.

## 2026-07-26: a variant WASM build without `SUFFIX` silently reuses cached objects

- **Context.** Measuring what `mujs=yes` costs, by building MuPDF's WASM twice.
- **What happened.** The variant build produced a binary byte-identical to stock, which
  reads exactly like "enabling mujs changes nothing". It was not. `make` caches object
  files per `build_suffix` (`platform/wasm/tools/build.sh:39`, with archive paths at lines
  63 and 64 under `../../build/wasm/$BUILD$SUFFIX/`), so without `SUFFIX` the second build
  reused the first build's objects and never compiled anything new.
- **What to do next time.** Set `SUFFIX` per configuration:
  `FEATURES="brotli=no extract=no xps=no svg=no" SUFFIX="mujs" bash tools/build.sh`.
  Treat any "the variant is byte-identical to stock" result as a suspected cache hit until
  `SUFFIX` is confirmed. The real cost of `mujs=yes` is 240,327 bytes.

## 2026-07-26: the MuPDF WASM build pins its own Emscripten, so it reproduces exactly

- **Context.** Deciding how much of the toolchain we needed to pin ourselves to make the
  committed-artifact freshness gate meaningful
  ([ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md)).
- **What happened.** A from-source build came out byte-identical to Artifex's published
  npm artifact: sha256 `f7d39be2...411bdebf`, 10,408,550 bytes. The reason is
  `tools/build.sh:27-28`, which runs `emsdk install 4.0.8` and `emsdk activate 4.0.8`
  regardless of the surrounding container.
- **What to do next time.** Do not spend effort pinning an emsdk image for correctness;
  the build pins itself. Pin it for speed if at all. The valuable consequence is that any
  byte difference in a future build is attributable to our patch and nothing else, which
  is what makes byte comparison a usable gate rather than an aspiration.

## 2026-07-26: `pdf_pkcs7_signer` is a vtable, not an OpenSSL type

- **Context.** Assessing whether browser-side signing was feasible at all.
- **What happened.** The name suggests a binding to a specific crypto library. It is
  actually a struct of function pointers, so anything that can produce a digest can sign.
  That single fact is the difference between "signing needs a crypto stack compiled into
  the WASM" and "signing uses WebCrypto and PKI.js while MuPDF keeps the ByteRange, the
  `/Contents` placeholder, the incremental save, and DocMDP".
- **What to do next time.** When a C API looks like it hard-codes a dependency, check
  whether it is a vtable first. See [ADR 0018](adr/0018-signing-via-custom-signer-vtable.md).

## 2026-07-26: mupdf.js has no FinalizationRegistry

- **Context.** Designing the render pipeline's memory model.
- **What happened.** All 27 wrapper classes require an explicit `.destroy()`, and garbage
  collecting the JavaScript wrapper does not free the native object. The failure mode is
  a viewer that passes every test, grows a few megabytes per rendered page in real use,
  and eventually aborts, because wasm32 memory cannot exceed 2 GiB and exceeding it aborts
  rather than throws. This is the single most common production failure in mupdf.js.
- **What to do next time.** Do not rely on review to catch a leaked handle. The two rule
  blocks at the end of `eslint.config.js` make an unowned `new mupdf.X()` a lint error.
  See [ADR 0009](adr/0009-wasm-memory-and-handle-discipline.md).

## 2026-07-26: `toPixmap()` cannot be cancelled, so tile size is a latency budget

- **Context.** Designing for responsive scrolling on heavy documents.
- **What happened.** Upstream issue #190: a render in flight cannot be abandoned, and the
  engine is single-threaded, so anything queued must be waited out. Tiling at 512 px is
  usually presented as a memory optimisation; here its real value is that it converts an
  uncancellable primitive into a pipeline cancellable at roughly 15 ms granularity.
- **What to do next time.** When a primitive cannot be cancelled, look for the granularity
  at which it effectively can be. See [ADR 0010](adr/0010-tiled-render-pipeline.md).

## 2026-07-26: check the advisory database before picking the obvious crate

- **Context.** Choosing the Rust text stack.
- **What happened.** The three most natural picks were all unusable. `rustybuzz` is
  RUSTSEC-2026-0206 (unmaintained), `ttf-parser` is RUSTSEC-2026-0192 (unmaintained), and
  RustCrypto `rsa` is RUSTSEC-2023-0071 (Marvin timing attack, still unpatched). All three
  sit on untrusted input or on the signing path. Separately, `wasm-pack` was archived when
  the rustwasm organisation was sunset in July 2025.
- **What to do next time.** Run `cargo audit` before the design, not after the
  implementation. The exclusions are enforced by `DENIED_CRATES` in
  `scripts/check-supply-chain.mjs` so a routine bump cannot silently undo them, and are
  recorded in the DENIED section of [`THIRD-PARTY.md`](THIRD-PARTY.md).

## 2026-07-26: `connect-src 'none'` is not achievable here, so prove the guarantee instead

- **Context.** Writing the CSP and the egress gate.
- **What happened.** The sibling photo-tools project can assert `connect-src 'none'` and
  grep the bundle for any outbound primitive. We cannot: the MuPDF WASM binary is fetched
  from our own origin at runtime, so `fetch` legitimately appears in the bundle. A claim of
  "no network primitives" would be false.
- **What to do next time.** State the narrower guarantee and prove it.
  `scripts/check-no-egress.mjs` fails on any absolute URL that is not same-origin, with an
  `INERT_HOST` allowlist where every entry carries a reason, and
  `tests/e2e/shell.e2e.ts` fails if the running application contacts a foreign origin. See
  [ADR 0002](adr/0002-client-side-only-zero-egress.md).

## 2026-07-26: a semantic-null sanitize filter is not visually null

- **Context.** Grading `pdf_filter_page_contents` with `pdf_new_sanitize_filter` as the
  write path for existing content.
- **What happened.** qpdf accepted every output and pdf.js extracted identical text, but
  pdf.js renders exceeded C8 for Ghostscript, pdfTeX, and LibreOffice documents. MuPDF's
  earlier self-round-trip missed all of this. The result is diffuse and therefore red under
  the decision table fixed before the test.
- **What to do next time.** Keep the producer/oracle separation, retain raw per-page
  metrics, and treat a semantic-null serializer as a mutation until an independent renderer
  proves otherwise. See [ADR 0020](adr/0020-content-stream-rewriting-failed-stage-one.md).

## 2026-07-26: included C exports must enter the declaration generator separately

- **Context.** Keeping the buffered processor implementation in a reviewable C overlay
  included by MuPDF's flat WASM shim.
- **What happened.** The binary linked, but upstream's declaration command deletes every
  `#include` line before preprocessing, so exports in the included file were absent from
  `mupdf-wasm.d.ts`. The build script also continued after TypeScript errors because it did
  not fail fast.
- **What to do next time.** Feed each shim source into `make-wasm-type.js`, run the build
  script with `set -eo pipefail`, and manifest both the low- and high-level wrapper
  artifacts.

## 2026-07-27: runtime tests of a committed binary do not prove its source provenance

- **Context.** Accepting a forked WASM engine whose generated artifacts are committed.
- **What happened.** Processor and oracle tests passed against the committed binary even
  when the C patches and build wiring were removed. They proved the bytes worked, but not
  that those bytes came from the reviewed source.
- **What to do next time.** Pair runtime behavior tests with a full rebuild-and-compare
  freshness check. Its negative control must make a semantic C-source change and require a
  rebuilt-artifact mismatch; checking only that a patch digest changed still does not prove
  the reviewed source produced the committed binary.
