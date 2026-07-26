---
name: Feature request
about: Propose a capability or an enhancement (see docs/ROADMAP.md)
title: ''
labels: enhancement
---

## What

<!-- The capability, and the user job it does. -->

## Why here

<!--
Why this belongs in a 100% client-side, zero-egress PDF editor.

Note that anything requiring a server, an account, a network call, or telemetry is a
non-goal rather than a backlog item. See docs/VISION.md.
-->

## Where it fits

<!-- Which phase in docs/ROADMAP.md, and what it depends on. -->

## Acceptance criteria

- [ ]

## Constraints it must respect

<!-- Delete what does not apply. -->

- [ ] No network request of any kind
- [ ] Stays within the resource ceilings in `lib/core/limits.ts`
- [ ] Correctness validated by pdf.js or qpdf, not by MuPDF
- [ ] Keyboard operable, WCAG 2.2 AA
- [ ] Works in all three densities and both themes
- [ ] Does not require an engine export that the WASM build lacks
