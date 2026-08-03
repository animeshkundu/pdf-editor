# 0032. Keep the trust landing page free of JavaScript

## Status

Accepted

## Date

2026-08-02

## Context

The landing page argues that a document never leaves the browser. A marketing runtime, consent
layer, animation framework, or third-party asset would weaken that argument before a visitor
opens the product. The page still needs theme parity, responsive evidence, comparison, and
disclosure interactions.

## Decision

The landing page ships no JavaScript. Its CSP is derived from its meta policy for the response
header and contains neither `script-src` nor `'unsafe-inline'`. Native `details` elements provide
disclosures and FAQ interaction. `prefers-color-scheme` selects real light and dark WebP product
captures; inline SVG is used only for the architecture data path. System fonts avoid adding
`font-src`.

The landing brotli ceiling is 200 kB because dual-theme product evidence is the central proof and
WebP cannot be materially recompressed. The reason lives beside the gate.

## Consequences

The page is inspectable in view source and adds no runtime supply-chain surface. It cannot offer
a site-level theme override, scripted tabs, scroll-driven reveals, or interactive comparison
widgets. Those costs are accepted.

## Notes

Enforced by `scripts/build-vercel-output.mjs`, `scripts/check-vercel-output.mjs`,
`scripts/check-bundle-size.mjs`, and the landing Playwright routes.
