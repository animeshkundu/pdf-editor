# 0006. A three-toolchain build, with WASM artifacts committed

## Status

Accepted

## Date

2026-07-26

## Context

Building this project from source requires three toolchains:

1. **Emscripten**, for the forked MuPDF C shim
   ([ADR 0004](0004-fork-the-mupdf-wasm-build.md)).
2. **Rust with the `wasm32-unknown-unknown` target**, plus `wasm-bindgen-cli` and
   `wasm-opt`, for `crates/pdftext` ([ADR 0005](0005-rust-font-module-scope.md)).
3. **Node.js 22.13 or newer with npm**, for the TypeScript application.

Deployment is static hosting on Vercel through the native Git integration. Vercel's
build image has Node. It does not have Emscripten and does not have Rust, and installing
either inside the deploy step would turn a fast static deploy into a long, fragile,
network-heavy build.

The alternatives were: give up the Git integration and deploy a prebuilt artifact from
CI; or install the toolchains on Vercel; or commit the built WebAssembly.

Committing build output is normally a bad practice, for one specific reason: nobody can
tell whether the committed binary corresponds to the committed source. That objection is
about verifiability, not about the commit itself.

**The rebuild-and-compare answer to that objection has been demonstrated, not just
designed.** A from-source build of stock MuPDF 1.28.0 is byte-identical to Artifex's
published npm artifact: sha256
`f7d39be2ea7bf8f65ffe1b11f405547d0a5b7e3b94d4c1ef59d16687411bdebf`, 10,408,550 bytes.
Byte comparison is therefore a viable gate rather than an aspiration, and any byte
difference in a future build is attributable to our patch and nothing else.

The reproducibility does not depend on us controlling the toolchain.
`platform/wasm/tools/build.sh:27-28` runs `emsdk install 4.0.8` and
`emsdk activate 4.0.8` regardless of the surrounding container, so the build pins its own
Emscripten. This removes an entire class of drift: a contributor with a different emsdk,
a CI image that updates underneath us, and a container rebuild all produce the same bytes.
The composite action in `.github/actions/setup-emsdk/` is a convenience for build speed,
not a correctness requirement.

## Decision

Commit the built WebAssembly artifacts, and make their correspondence to source
provable.

- `vendor/mupdf-wasm/dist/` is committed. The upstream source tree
  (`vendor/mupdf-wasm/src/`), the Emscripten build directory, and the emsdk are
  gitignored, since the source is fetched on demand and the build cache is machine-local.
- `vendor/wasm-manifest.json` records, for every artifact, the SHA-256 of the artifact
  itself, the SHA-256 of each source input, and the toolchain versions used.
- `scripts/check-wasm-fresh.mjs` verifies that manifest. It has two modes.
  `--manifest-only` verifies that the committed artifacts match their recorded digests,
  which is fast and is what `npm run build:vercel` runs on every deploy. The default mode
  additionally verifies the source identity and digests, rebuilds all five artifacts, and
  byte-compares the rebuilt output with the committed output without replacing it. That
  source-to-artifact proof is what CI runs.
- Line endings are normalised to LF repository-wide in `.gitattributes`, and `*.wasm` is
  marked binary. Development happens on Windows and CI runs on Linux; without this, an
  identical artifact would produce different digests on the two platforms and the
  freshness gate would fail for a reason unrelated to the artifacts.

`npm run build` is the full build (`build:wasm` then `build:web`).
`npm run build:vercel` is the deploy build: verify the manifest, then build the web app
only. A fresh clone with only Node installed can build and run the application.

`scripts/build-wasm.mjs` exits 0 rather than failing when the vendored source is absent
but artifacts are present, so a contributor without Emscripten is not blocked. Only CI,
which runs `check:wasm:fresh` in full mode, requires the source tree.

## Consequences

### Positive

- Vercel's Git integration keeps working, with a fast deploy and no native toolchain.
- Contributors who only touch TypeScript need only Node.
- The usual objection to committed binaries is answered by an executable proof rather
  than by a promise.

### Negative

- Repository size grows with each artifact revision. The MuPDF binary alone is 10,408,550
  bytes for the stock build, and 10,648,877 with `mujs=yes`
  ([ADR 0004](0004-fork-the-mupdf-wasm-build.md)).
- A change to the C shim or the Rust crate requires committing rebuilt artifacts and a
  regenerated manifest in the same change, which is easy to forget until CI catches it.
- Three toolchains have to be installable and documented for anyone touching the engine
  layers.

### Neutral

- The manifest is the contract. If it ever disagrees with reality, the gate fails
  closed; `check-wasm-fresh.mjs` treats a missing artifact and a digest mismatch as
  equally fatal, and treats a missing manifest as "nothing to verify yet".
- A variant build must set `SUFFIX`, or `make` reuses the previous configuration's object
  files and emits a byte-identical binary. Automation of the fork build has to account for
  this, and a "no change" result should be treated as a suspected cache hit until `SUFFIX`
  is confirmed. See
  [ADR 0004](0004-fork-the-mupdf-wasm-build.md#implementation-note-the-suffix-object-cache-trap).

## Notes

Scripts: `scripts/build-wasm.mjs`, `scripts/check-wasm-fresh.mjs`, `scripts/cargo.mjs`.
Configuration: `.gitignore`, `.gitattributes`, and the `build:vercel` script in
`package.json`. Deployment detail is in [`../PUBLISHING.md`](../PUBLISHING.md).
