# Third-party software

Every JavaScript dependency is exact-version pinned in `package.json` and
`package-lock.json`. No range specifiers.

The project is licensed **AGPL-3.0-only**, which follows from MuPDF
([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)). Every shipped component must be
AGPL-compatible. A dependency with an incompatible licence is a merge blocker.

## DENIED

These are **excluded on purpose**. Each is a natural choice that a routine dependency
bump or a well-meaning refactor could reintroduce without anyone noticing, so the
exclusion is enforced by `scripts/check-supply-chain.mjs`, which fails the build if any of
them appears in `crates/pdftext/Cargo.lock`.

| Component          | Advisory          | Reason                                                                                                                                 | Use instead                |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `rustybuzz`        | RUSTSEC-2026-0206 | Unmaintained. It parses untrusted font data taken directly out of a user's PDF.                                                        | `harfrust`                 |
| `ttf-parser`       | RUSTSEC-2026-0192 | Unmaintained, and a transitive dependency of much of the Rust text ecosystem, so avoiding it also constrains what else can be adopted. | `skrifa` / `read-fonts`    |
| `rsa` (RustCrypto) | RUSTSEC-2023-0071 | Marvin timing attack, **still unpatched**. Would sit on the signing path.                                                              | WebCrypto (`SubtleCrypto`) |

Two further exclusions are decisions rather than advisories, and are recorded here so they
are not quietly reversed either:

| Component          | Reason                                                                                           | Use instead                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `cms` (RustCrypto) | Pre-release. Detached-signature support, which is exactly what PDF signing needs, is unverified. | PKI.js ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md))                   |
| `wasm-pack`        | Archived when the rustwasm organisation was sunset in July 2025.                                 | `wasm-bindgen-cli` plus `wasm-opt` ([ADR 0005](adr/0005-rust-font-module-scope.md)) |

Reintroducing anything in this section requires a superseding ADR.

## Shipped: npm

Present in `package.json` today.

| Component                | Version | Source                              | License           | Purpose                                                        |
| ------------------------ | ------: | ----------------------------------- | ----------------- | -------------------------------------------------------------- |
| MuPDF                    |  1.28.0 | npm `mupdf`                         | AGPL-3.0-or-later | PDF engine: parse, repair, render, structured text, edit, save |
| React                    |  19.2.7 | npm `react`                         | MIT               | Editor UI                                                      |
| React DOM                |  19.2.7 | npm `react-dom`                     | MIT               | Browser renderer                                               |
| Zustand                  |  5.0.14 | npm `zustand`                       | MIT               | Application state outside React's render path                  |
| Radix Dialog             |  1.1.19 | npm `@radix-ui/react-dialog`        | MIT               | Accessible modal primitives                                    |
| Radix Dropdown Menu      |  2.1.20 | npm `@radix-ui/react-dropdown-menu` | MIT               | Accessible menu primitives                                     |
| Radix Popover            |  1.1.19 | npm `@radix-ui/react-popover`       | MIT               | Accessible popover primitives                                  |
| Radix Scroll Area        |  1.2.14 | npm `@radix-ui/react-scroll-area`   | MIT               | Custom scroll containers                                       |
| Radix Select             |   2.3.3 | npm `@radix-ui/react-select`        | MIT               | Accessible select primitives                                   |
| Radix Slot               |   1.3.0 | npm `@radix-ui/react-slot`          | MIT               | Composition primitive for shadcn-style components              |
| Radix Tabs               |  1.1.17 | npm `@radix-ui/react-tabs`          | MIT               | Accessible tab primitives                                      |
| Radix Tooltip            |  1.2.12 | npm `@radix-ui/react-tooltip`       | MIT               | Accessible tooltip primitives                                  |
| class-variance-authority |   0.7.1 | npm `class-variance-authority`      | Apache-2.0        | Component variant definitions                                  |
| clsx                     |   2.1.1 | npm `clsx`                          | MIT               | Conditional class composition                                  |
| tailwind-merge           |   3.6.0 | npm `tailwind-merge`                | MIT               | Tailwind class conflict resolution                             |
| lucide-react             |  1.25.0 | npm `lucide-react`                  | ISC               | Icon set                                                       |

## Shipped: planned, not yet added

**None of the components in this table is in the build today.** They are recorded so the
SBOM matches the architecture and so a reviewer can tell a planned component from a
shipped one. Each moves into the table above, with an exact pinned version, at the commit
that introduces it.

| Component       | Source                                          | License           | Purpose                                                                                      | ADR                                                  |
| --------------- | ----------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| MuPDF WASM fork | Artifex source, patched in `vendor/mupdf-wasm/` | AGPL-3.0-or-later | Adds `js_processor`, `pdf_filter_page_contents`, `mujs=yes`, and a custom `pdf_pkcs7_signer` | [0004](adr/0004-fork-the-mupdf-wasm-build.md)        |
| `harfrust`      | crates.io                                       | MIT / Apache-2.0  | Text shaping. Replaces `rustybuzz`.                                                          | [0005](adr/0005-rust-font-module-scope.md)           |
| `skrifa`        | crates.io (Fontations)                          | MIT / Apache-2.0  | Font parsing and glyph access. Replaces `ttf-parser`.                                        | [0005](adr/0005-rust-font-module-scope.md)           |
| `read-fonts`    | crates.io (Fontations)                          | MIT / Apache-2.0  | Low-level font table reading                                                                 | [0005](adr/0005-rust-font-module-scope.md)           |
| `write-fonts`   | crates.io (Fontations)                          | MIT / Apache-2.0  | Font table writing                                                                           | [0005](adr/0005-rust-font-module-scope.md)           |
| `subsetter`     | crates.io                                       | MIT / Apache-2.0  | Embeddable font subsets                                                                      | [0005](adr/0005-rust-font-module-scope.md)           |
| `unicode-bidi`  | crates.io                                       | MIT / Apache-2.0  | UAX #9 bidirectional reordering                                                              | [0005](adr/0005-rust-font-module-scope.md)           |
| PKI.js          | npm `pkijs`                                     | BSD-3-Clause      | CMS SignedData construction around WebCrypto                                                 | [0018](adr/0018-signing-via-custom-signer-vtable.md) |

Licences in this table are the projects' stated licences and are **verified at the commit
that adds each dependency**, not before. Treat them as expected values until then.

## Development and CI only

Never bundled, never shipped.

| Component                   | Version | Source                            | License    | Purpose                                     |
| --------------------------- | ------: | --------------------------------- | ---------- | ------------------------------------------- |
| TypeScript                  |   6.0.3 | npm `typescript`                  | Apache-2.0 | Strict type checking                        |
| Vite                        |   8.1.5 | npm `vite`                        | MIT        | Build and dev server                        |
| React Vite plugin           |   6.0.3 | npm `@vitejs/plugin-react`        | MIT        | JSX build integration                       |
| Tailwind CSS                |   4.3.3 | npm `tailwindcss`                 | MIT        | Token and utility compilation               |
| Tailwind Vite plugin        |   4.3.3 | npm `@tailwindcss/vite`           | MIT        | Stylesheet build integration                |
| ESLint                      |  10.7.0 | npm `eslint`                      | MIT        | Linting, including the WASM handle rules    |
| `@eslint/js`                |  10.0.1 | npm `@eslint/js`                  | MIT        | ESLint recommended rule set                 |
| typescript-eslint           |  8.64.0 | npm `typescript-eslint`           | MIT        | TypeScript linting                          |
| eslint-plugin-react-hooks   |   7.1.1 | npm `eslint-plugin-react-hooks`   | MIT        | Hook rules                                  |
| eslint-plugin-react-refresh |   0.5.3 | npm `eslint-plugin-react-refresh` | MIT        | Fast-refresh boundary rules                 |
| globals                     |  17.7.0 | npm `globals`                     | MIT        | Environment global definitions              |
| Prettier                    |   3.9.5 | npm `prettier`                    | MIT        | Formatting                                  |
| Vitest                      |  4.1.10 | npm `vitest`                      | MIT        | Unit tests                                  |
| jsdom                       |  29.1.1 | npm `jsdom`                       | MIT        | DOM environment for per-file test overrides |
| Playwright                  |  1.61.1 | npm `@playwright/test`            | Apache-2.0 | Production-artifact browser tests           |
| `@types/node`               | 24.13.3 | npm                               | MIT        | Node type definitions                       |
| `@types/react`              | 19.2.17 | npm                               | MIT        | React type definitions                      |
| `@types/react-dom`          |  19.2.3 | npm                               | MIT        | React DOM type definitions                  |

### Toolchains and oracles, not installed from the lockfile

| Component                                 | Source               | License          | Purpose                                                                                         |
| ----------------------------------------- | -------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Emscripten (emsdk)                        | emscripten-core      | MIT / NCSA       | Builds the forked MuPDF WASM ([ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md)) |
| Rust toolchain + `wasm32-unknown-unknown` | rust-lang            | MIT / Apache-2.0 | Builds `crates/pdftext`                                                                         |
| `wasm-bindgen-cli`                        | crates.io            | MIT / Apache-2.0 | Rust to WASM bindings. Replaces `wasm-pack`.                                                    |
| `wasm-opt` (Binaryen)                     | WebAssembly/binaryen | Apache-2.0       | WASM size and speed optimisation                                                                |
| `cargo-audit`                             | crates.io            | MIT / Apache-2.0 | Rust advisory scanning. Required in CI by `scripts/check-supply-chain.mjs`.                     |
| **pdf.js**                                | mozilla/pdf.js       | Apache-2.0       | **Independent acceptance reader and renderer** ([ADR 0019](adr/0019-correctness-oracles.md))    |
| **qpdf**                                  | qpdf/qpdf            | Apache-2.0       | **Independent structural validator** ([ADR 0019](adr/0019-correctness-oracles.md))              |

pdf.js and qpdf are the correctness oracles. **MuPDF is never the acceptance reader for
output MuPDF produced.** They are test-only and must never enter `dist/`.

## Adding a dependency

1. Check the licence is AGPL-compatible. Record the SPDX identifier.
2. Check it is not in the DENIED section, transitively included or otherwise.
3. Pin the exact version. No `^`, no `~`.
4. Add a row to the correct table here in the same pull request.
5. Run `npm run check:supply`. For a shipped dependency, also run `npm run check:size` and
   `npm run check:egress` against a fresh build.
