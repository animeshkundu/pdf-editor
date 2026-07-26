# PDF Editor vision

Adobe Acrobat has the right mental model for working with documents and a product that
has spent twenty years accumulating around it. Every credible web alternative solves the
wrong half: it moves the document to a server.

This project is the other answer. Acrobat's model, executed better, running entirely in
the browser, with the document never leaving the device.

## Product principles

1. **Private by construction, not by policy.** There is no server. The deployment is
   static hosting with no function, no middleware, and no endpoint that could receive a
   document, and the absence of third-party traffic is proved by an executable gate rather
   than a privacy page ([ADR 0002](adr/0002-client-side-only-zero-egress.md), which is
   explicit about what the gates prove and what rests on review).

2. **A real editor, not a viewer with annotations.** Edit text in place, reflow it, fill
   and calculate forms, redact so the content is actually gone, sign, and save
   incrementally so existing signatures survive. Anything less is a viewer wearing an
   editor's label.

3. **The document is the hero.** Chrome recedes. Nothing floats over the page. Panels
   are resizable, can be open together, and never occlude what the user is reading.

4. **Density is the user's choice.** Compact, comfortable, and touch are peers, resolved
   in the token layer so no component contains conditional CSS
   ([ADR 0016](adr/0016-density-aware-design-tokens.md)). Acrobat's 2023 redesign took
   density away from desktop users with no way back; that is a mistake worth not
   repeating.

5. **Light and dark are peers.** Long-form reading in a dark room is a primary use case,
   not an accommodation. Dark is designed, not derived by inversion. The page itself stays
   the colour the document says it is; a night-reading transform is separate and opt-in.

6. **Fast failure is a feature.** Project the cost, assert the ceiling, then mutate.
   A rejection arrives before anything is touched and explains itself in terms the user
   can act on. A half-edited document is worse than a refused edit
   ([ADR 0014](adr/0014-resource-ceilings.md)).

7. **Correctness is judged from outside.** A document we wrote is accepted by pdf.js and
   qpdf, never by the engine that produced it
   ([ADR 0019](adr/0019-correctness-oracles.md)). A file that only our stack likes is not
   a working file.

8. **Everything is reachable by name.** A command palette, real focus states, and
   keyboard operation for every command. A tool with hundreds of commands must not require
   knowing which of eight menus holds the one you want.

9. **Say exactly what is true.** Name the browser floor, the ceilings, what signing does
   and does not cover, and which editing path an operation took. A capability claim that
   overstates what shipped is treated as a defect, not as marketing.

## Non-goals

- **Any server component.** No accounts, no cloud storage, no sync, no collaboration, no
  server-side conversion, no telemetry, no analytics, no advertising. These are not
  deferred; they are excluded, because admitting any of them dissolves the product's
  reason to exist.
- **Long-term validation signatures.** Timestamping (RFC 3161), OCSP and CRL revocation
  checking, and PAdES B-LT / B-LTA all require network access
  ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)). We support basic and
  certification signatures and say plainly that we do not do the rest.
- **Mobile parity.** iOS and iPadOS are supported under a materially lower budget because
  iOS Safari kills the tab, with no catchable error, when a WebAssembly instance grows too
  large ([ADR 0013](adr/0013-supported-browser-matrix.md)). The touch density mode makes
  tablet work comfortable; it does not make it equivalent.
- **Legacy browsers.** MuPDF's build requires native WebAssembly exception handling. The
  floor is Chrome 95, Firefox 131, and Safari 15.2, and it is not ours to lower.
- **A plugin or extension ecosystem.** Not now. Extensibility that predates a stable core
  buys nothing and constrains everything.
- **Being an Acrobat feature clone.** The model is the reference, not the feature list.
  Shipping a worse version of every Acrobat feature is not the goal; shipping the ones
  people actually use, done properly, is.

## What success looks like

Someone who edits PDFs all day tries this because their document cannot leave their
laptop, and keeps using it because it is better.
