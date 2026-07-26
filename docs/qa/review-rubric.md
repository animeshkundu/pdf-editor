# Review rubric

Use this for every pull request. Review the changed behaviour end to end, not the diff in
isolation, and record evidence for each applicable item. Mark an item **N/A** only with a
stated reason.

## Merge blockers

These are never negotiable and never deferred. A pull request that trips one does not
merge, regardless of how much work is in it.

1. **Privacy.** Any document byte, page image, filename, or derived artifact that could
   reach a third party. Any weakening of the CSP in `web/index.html`. Any new absolute URL
   in shipped output. Any addition to `INERT_HOST` without a stated reason. Any serverless
   function, edge middleware, or same-origin endpoint that could receive a document: the
   gates do not catch a same-origin request, so this one rests on you
   ([ADR 0002](../adr/0002-client-side-only-zero-egress.md)).
2. **Data loss.** Any path where a user can lose work: a mutation that can fail partway,
   a persistence write that can leave a truncated file, a cancellation that discards
   committed state.
3. **Silent document corruption.** Output that opens in our stack and is wrong. This is
   the worst failure this product can have, because the user finds out later, somewhere
   else, and cannot tell what happened. Acceptance is by pdf.js or qpdf, never by MuPDF
   ([ADR 0019](../adr/0019-correctness-oracles.md)).
4. **Memory safety and WASM handle leaks.** An unowned MuPDF handle, a release path that
   an exception can skip, a retained object with no eviction policy, or a mutation that
   happens before its ceiling assertion.
5. **Inaccessible core flows.** A command that cannot be reached or operated by keyboard,
   a missing or removed focus indicator, an unlabelled control on a core path, or an error
   that is not announced.
6. **Misleading capability claims.** Any user-facing text, docs, or commit message that
   presents a planned capability as shipped, or that overstates what signing, redaction,
   or text editing actually does.

## Procedure

- [ ] Read the issue, the diff, the surrounding implementation, and the ADRs the change
      operates under.
- [ ] Identify the user job, the inputs it accepts, the outputs it produces, and every
      failure path.
- [ ] Confirm the pull request is one bounded concern and fits the phase order in
      [`../ROADMAP.md`](../ROADMAP.md).
- [ ] Run `npm run check`, then `npm run build:web`, `npm run check:egress`, and
      `npm run check:size`.
- [ ] Run `npm run test:e2e` against the production build.
- [ ] Drive the changed workflow yourself, in the browser, with a real PDF.
- [ ] Exercise empty, invalid, boundary, cancellation, repeated-failure, and
      memory-pressure paths.
- [ ] Report only reproducible findings, in severity order, each with `file:line`, the
      impact, and the smallest concrete fix. Record unverified behaviour as a verification
      gap, never as passing.

## Privacy and egress

- [ ] No document data enters a request, a log, a URL, or storage outside OPFS.
- [ ] No serverless function, edge middleware, or same-origin endpoint capable of receiving
      a document has been added. `vercel.json` still declares a purely static deployment.
      The automated gates do **not** cover this; it is checked by reading the diff.
- [ ] The CSP in `web/index.html` is unchanged, or the change is widening-free and carries
      a superseding ADR.
- [ ] `npm run check:egress` passes on a fresh build. Any new `INERT_HOST` entry has a
      stated reason and is genuinely inert.
- [ ] The E2E foreign-origin assertion still runs and still fails closed.
- [ ] No analytics, telemetry, error reporting, remote configuration, CDN font, or
      third-party script has been added.
- [ ] OPFS content is origin-private, evicted when the document closes, and clearable by
      the user.

## Document correctness

- [ ] Any document we wrote is accepted by **pdf.js or qpdf**. A MuPDF round trip is not
      evidence.
- [ ] Content-stream rewrites go through `pdf_filter_page_contents` with
      `pdf_new_sanitize_filter`. Hand-assembled content streams are rejected.
- [ ] Marked content and the structure tree survive the edit. An edit inside a tagged
      region does not silently untag it.
- [ ] For a text edit, the path taken (in-place versus re-embedded subset) is determined by
      attempting the inversion, not predicted, and is surfaced to the user
      ([ADR 0012](../adr/0012-content-stream-text-editing.md)).
- [ ] Redaction removes content from the stream. A black rectangle over text is not
      redaction and must not be described as such.
- [ ] Incremental saves leave existing signatures valid, verified outside our stack.
- [ ] `assertSaveFlags()` still refuses every conflicting combination.

## Memory and handles

- [ ] `mupdf` is imported only inside `lib/engine/worker/`. Everything else goes through
      `lib/engine/port.ts`.
- [ ] Every MuPDF construction is wrapped in `arena.keep(...)` or `retain(key, ...)`.
- [ ] Release happens in `finally` and in reverse acquisition order, on success, failure,
      and cancellation alike.
- [ ] Every retained object has a named owner and a documented eviction trigger.
- [ ] Cost is projected and asserted **before** mutation. No operation can discover a
      ceiling mid-way.
- [ ] Arithmetic that could overflow uses `BigInt` and clamps, per
      `projectRenderBytes()` and `assertHeadroom()`.
- [ ] Any ceiling change updates `lib/core/limits.ts`, `tests/limits.test.ts`, and
      [ADR 0014](../adr/0014-resource-ceilings.md) together, and carries a superseding ADR
      for the value change.
- [ ] Superseded or cancelled work releases the handles it allocated rather than applying
      its result.

## Workers and rendering

- [ ] Worker death is handled: in-flight promises reject with a typed error, none are left
      pending, and other documents are unaffected.
- [ ] Every request carries a correlation id and stale responses are discarded.
- [ ] No single `toPixmap()` exceeds `maxRenderPixels`. Tiles stay at or below 512 px.
- [ ] Layout comes from the prefix sum, never from DOM measurement.
- [ ] Scroll and zoom do not cause a React render pass.
- [ ] Bitmap cache eviction is furthest-from-viewport first and respects `bitmapBudget`.

## Accessibility

- [ ] Every command is keyboard reachable and operable, in a logical focus order.
- [ ] The focus indicator is visible and unclipped everywhere. No component overrides
      `:focus-visible` away.
- [ ] Icon-only controls have accessible names. Landmarks, the skip link, and the single
      `h1` are intact.
- [ ] Errors use `role="alert"`, name the failed action, and state the next step.
- [ ] Disabled controls carry an adjacent explanation.
- [ ] Contrast meets WCAG 2.2 AA in **both** themes.
- [ ] `prefers-reduced-motion: reduce` and `forced-colors: active` were **exercised**, not
      inferred from the presence of a CSS rule.
- [ ] Content reflows at 200% zoom and a 320 px viewport without loss of function.
- [ ] `touch` density meets WCAG 2.2 target sizing.
- [ ] The hidden reading-order element reflects logical order, and Ctrl+F still routes to
      engine search.

## Design system

- [ ] Components reference **semantic** tokens only. No palette token and no raw value in
      a component.
- [ ] The change was inspected in all three densities and both themes.
- [ ] Motion stays within 120 to 180 ms with `--ease-out`, and is functional rather than
      decorative.
- [ ] Nothing floats over or occludes the document pane.
- [ ] `--page-paper` is untouched. Any page-appearance transform is an explicit view mode.

## Build, tests, and dependencies

- [ ] Changed behaviour has deterministic Vitest coverage that would fail without the
      change, including boundary and error paths. No test, assertion, or coverage was
      weakened.
- [ ] Browser-dependent behaviour is covered by production-artifact E2E rather than
      skipped when the unit environment lacks an API.
- [ ] No test is skipped unless the skip is itself the behaviour under test, with a stated
      reason.
- [ ] Any change to the C shim or the Rust crate ships rebuilt artifacts **and** a
      regenerated `vendor/wasm-manifest.json` in the same pull request, and
      `npm run check:wasm:fresh` passes in full mode.
- [ ] Every dependency is exact-pinned and appears in
      [`../THIRD-PARTY.md`](../THIRD-PARTY.md) with version, source, SPDX licence, and
      purpose.
- [ ] Nothing from the DENIED section reappears, transitively or otherwise.
      `npm run check:supply` passes.
- [ ] New dependency licences are AGPL-compatible.
- [ ] `npm run check:size` passes, and any budget change in
      `scripts/check-bundle-size.mjs` is deliberate and explained.
- [ ] The changed-file list matches the declared scope and contains no generated,
      dependency, temporary, credential, or unrelated file.
- [ ] The diff, commits, pull request, comments, and documentation contain **no
      attribution to generative or automated tooling**.

## Documentation

- [ ] A decision with lasting consequences has an ADR in the same pull request.
- [ ] An ADR contradicted by new evidence is **superseded**, not quietly edited.
- [ ] `docs/CHANGELOG.md` records user-visible changes under `[Unreleased]`.
- [ ] A durable lesson is recorded in `docs/LEARNINGS.md` or `docs/history/`.
- [ ] Documentation describes what shipped. Nothing planned is described as available.
