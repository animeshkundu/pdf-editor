# 0013. Supported browser matrix

## Status

Accepted

## Date

2026-07-26

## Context

The browser floor is not a product choice. It is imposed by the engine.

MuPDF's WebAssembly build is compiled with `-fwasm-exceptions`, which uses **native
WebAssembly exception handling** rather than the older JavaScript-based emulation. A
browser without that proposal cannot instantiate the module at all. The failure is total
and immediate, not a degraded experience.

This is **verified in the build, not inferred**. `platform/wasm/tools/build.sh` carries
`-fwasm-exceptions` at line 53 and `-sSUPPORT_LONGJMP=wasm` at line 54. Both require the
exception-handling proposal, so the floor follows from the link line rather than from
reading about the flag elsewhere.

Native WASM exception handling shipped in:

| Engine                   | Version |
| ------------------------ | ------- |
| Chrome / Chromium / Edge | 95      |
| Firefox                  | 131     |
| Safari                   | 15.2    |

Firefox is the constraint: it shipped the proposal much later than the others, so the
floor is set by a browser released in October 2024.

Two further platform facts belong in the matrix rather than in a footnote:

- The engine is single-threaded, so `SharedArrayBuffer` is not used and **COOP/COEP
  headers are not required** ([ADR 0008](0008-worker-topology-and-crash-isolation.md)).
  Verified: `tools/build.sh` contains **no `-pthread` and no `-sUSE_PTHREADS`** anywhere.
  Omitting cross-origin isolation from `vercel.json` is therefore correct, not merely
  convenient.
- **iOS Safari terminates the tab** when a WebAssembly instance exceeds its per-tab
  budget, with no catchable error and no chance to degrade gracefully. This is why
  `IOS_BUDGET` in `lib/core/limits.ts` is a set of measured survival thresholds rather
  than a scaled-down desktop budget.

Two further build flags shape what the application can assume, and are recorded here
because they are easy to rediscover the hard way:

- `-sFILESYSTEM=0`. There is no MEMFS, so a document is passed in as a buffer or through
  a `mupdf.Stream`. No code may assume a filesystem path.
- `-sMODULARIZE=1 -sEXPORT_ES6=1`, which is what makes the ES module worker setup in
  `vite.web.config.ts` work ([ADR 0007](0007-vite-over-a-meta-framework.md)).

## Decision

The supported matrix is:

- Chrome, Chromium, and Edge 95 and newer.
- Firefox 131 and newer.
- Safari 15.2 and newer, desktop.

iOS and iPadOS Safari 15.2 and newer are supported under the reduced budget in
`IOS_BUDGET`. Full mobile parity is not claimed; the editor targets a pointer and a
keyboard, and the touch density mode ([ADR 0016](0016-density-aware-design-tokens.md))
makes tablet use workable rather than equivalent.

The floor is encoded in three places and they must stay in agreement:

- `vite.web.config.ts`: `build.target: ['chrome95', 'firefox131', 'safari15.2']`.
- `tests/e2e/playwright.config.ts`: Chromium and Firefox projects, both driving the
  production build.
- This ADR.

Capability, not user agent, decides what the running application does. A browser that
cannot instantiate the module gets a clear, accessible explanation naming the
requirement, not a blank page or a stack trace. iOS-like devices are detected by
`isIosLike()`, which checks touch capability alongside the user-agent string because
iPadOS reports a desktop Macintosh string.

Raising or lowering the floor requires a superseding ADR and a matching change to all
three locations.

## Consequences

### Positive

- The floor is derived from a hard technical requirement, so it is defensible and
  stable.
- Everything above the floor gets modern platform features (OPFS with
  `createSyncAccessHandle`, `ImageBitmap` in workers, `structuredClone`) without
  polyfills.

### Negative

- Firefox 131 is a recent floor, which excludes some enterprise and long-term-support
  configurations.
- iOS support is real but materially reduced, and the reason is a platform behaviour we
  cannot work around.

### Neutral

- Playwright covers Chromium and Firefox. Safari and iOS are verified manually until
  WebKit coverage is added; that gap is stated rather than papered over.

## Notes

Cited by `vite.web.config.ts` and `tests/e2e/playwright.config.ts`. Budgets are
[ADR 0014](0014-resource-ceilings.md) and `lib/core/limits.ts`.
