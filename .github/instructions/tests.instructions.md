---
applyTo: '**/*.{test,spec,e2e}.{ts,tsx,js,jsx}'
---

# Test conventions

Frameworks: Vitest for unit tests, Playwright for end-to-end.
Directories: `tests/` for unit tests, `tests/e2e/` for browser tests.
Commands: `npm run test`, `npm run test:e2e`.

- Unit tests run in `node` by default. A file needing a DOM uses
  `// @vitest-environment jsdom` at the top. `lib/` kernels are framework-free and
  DOM-free by construction.
- End-to-end tests drive the **production build** via `npm run preview`, never the dev
  server. WASM loading, worker instantiation, and chunk splitting all behave differently
  under Vite's dev transform, and those are the paths most likely to break.
- Keep tests deterministic, isolated, and independent. Prefer focused assertions over
  broad snapshots.
- Add or strengthen tests for every behaviour change and bug fix. A test for a fix must
  fail against the original bug.
- Never skip, delete, or relax a test to make a branch green. A skip is acceptable only
  when the skip is itself the behaviour under test, with a stated reason.

## Project-specific rules

- **Never use MuPDF as the acceptance reader for output MuPDF produced.** A document we
  wrote is validated with pdf.js or qpdf. A MuPDF round trip proves self-consistency and
  nothing else. See `docs/adr/0019-correctness-oracles.md`.
- Ceiling changes are tested at the boundary: the value itself passes and one unit beyond
  it fails with the documented `LimitCode`. See `tests/limits.test.ts`.
- Assert the user-facing message, not just the code. `LimitError` messages are part of the
  contract.
- Test overflow paths explicitly. Adversarial dimensions computed as `Number` wrap to a
  small float and sail past the check meant to catch them.
- Cover both `DESKTOP_BUDGET` and `IOS_BUDGET` where behaviour differs between them.
- Test worker death, not just worker success: in-flight promises must reject with a typed
  error, never hang.
- Test cancellation and supersession. A stale response must be discarded and its handles
  released.
- End-to-end tests assert no cross-origin request and no console error. Both fail closed.
- Accessibility assertions cover landmarks, the skip link, the single `h1`, focus order,
  and that the density switch actually changes the resolved token value.

Record durable testing gotchas in `docs/LEARNINGS.md` or `docs/history/`.
