# Form capability evidence — 2026-08-01

## Scope

This finding records the bounded AcroForm work for `FORM-001` through `FORM-013` and
`FORM-023` and the final inventory decisions. Scalar filling, authored tab order, list
highlighting, and required validation ship with their disclosed limits. Barcode authoring,
persistent history, and real-document field detection are labelled `EXCLUDED` because their
required engine or protocol surface is absent; kernels alone are not presented as product
capabilities.

## Appearance evidence

New fields use one field-level default appearance, emitted through MuPDF's
`setDefaultAppearance`, with a document-level `/AcroForm/DR/Font` Type 1 Helvetica
resource named `FormHelv` (or a collision-free numbered equivalent). The appearance syntax
is `/FormHelv 12 Tf 0 0 0 rg`. The mutation does not separately write `/DA`, avoiding
conflicting duplicate default-appearance writes. It generates `/AP` with `widget.update()`
and sets `/NeedAppearances false`, so independent readers consume supplied appearances
rather than being asked to guess them.

`tests/forms.oracle.test.ts` saves authored and filled fields, then validates them with
qpdf and pdf.js. It additionally uses qpdf's QDF serialization to assert one `/DA` on the
widget object and the authored annotation order with `/Tabs /A`.

## Bound values

The existing serializable protocol represents one value as `string | boolean`.

- Text (including multiline, password, and comb), checkbox, a single radio choice, combo,
  and single-select list values are written through the engine.
- Radio option export values are exposed in the existing `options` field when widget
  appearance states provide them. A boolean grouped-radio write deterministically selects
  the first widget; callers that need a specific member pass its exposed export value.
- A multi-select list is authorable, but filling it is explicitly refused: one scalar value
  cannot represent a selection set. This is not silently joined or approximated.
- Buttons never gain a submit action here. Unsigned signature fields remain unsigned and
  are not presented as a signing facility.

The current `FormFieldInfo` type exposes page rectangle, type, options, and scalar value.
It cannot expose `comb`, editable-combo, multi-select, or a document fingerprint. Those
are driver integration requests below.

## Canvas geometry and required validation

`lib/forms/capabilities.ts` turns `listFields` output into canvas-ready page-widget
highlight geometry. `PrepareForm` exposes it as data only; it does not place page text in
the DOM. The viewport owner can consume it in its existing canvas overlay.

Required validation returns every missing field by name. The form-data export action calls
that validation first and is blocked with all failing names. There is no remote submission
path, by product design.

## Local history

`FormHistory` is framework-free, disabled by default, clearable, and requires an opaque
document-scoped identity in its constructor. Its storage key includes that identity, so
entries from different identities cannot be read together. `PrepareForm` does not enable
it because the existing engine port offers no stable document identity; deriving one from a
name or page count would risk crossing document boundaries and is rejected.

## Detection fixture and floor

`tests/forms-capabilities.test.ts` contains a labelled, deterministic fixture with two
expected fields and one rejected heading rule. The proposal heuristic's acceptance floor is
precision >= 0.90 and recall >= 0.90 on that fixture. Output is marked `proposalOnly: true`;
it is not a `FormFieldInput` and no mutation call is made automatically.

This is evidence for a proposal kernel only, not a claim that arbitrary PDFs are currently
scanned. The port has no page text geometry endpoint for the detector.

## Barcode decision

No barcode encoder is shipped. The repository has no independently decodable encoder under
the existing dependency and licence constraints, and no exact-pinned dependency was added.
`FORM-008` therefore remains unsupported rather than creating a barcode field that only our
writer can interpret.

## Inventory decisions

- `FORM-009`, `FORM-010`, `FORM-011`, and `FORM-012` are checked at `DEGRADED`. Each has a
  functional path and a point-of-use disclosure: scalar list filling, authored/list tab order,
  list highlighting with canvas-ready geometry, and required validation on form-data export.
- `FORM-008`, `FORM-013`, and `FORM-023` are `EXCLUDED`, unchecked. No barcode encoder is
  bundled; history is not wired without a stable document identity; and detection cannot scan
  a real page without text geometry. The implementations refuse or remain disabled rather than
  manufacture success.

## Remaining prerequisites

1. Add a stable, opaque document fingerprint to the existing read-side `DocumentInfo` so
   opted-in local history can be wired without weak name-based scoping.
2. Extend `FormFieldInfo` with comb, editable-combo, multi-select, and radio-member state,
   and extend `setFieldValue(s)` with a string-array choice value for multi-select lists.
3. Pass `formWidgetHighlights` to the viewport canvas overlay and add page-coordinate widget
   hit testing before promoting `FORM-010` or full `FORM-011`.
4. Expose page text/line geometry to drive `FORM-023` proposals; proposals must remain
   explicitly accepted before `createFormField`.
5. Invoke required validation from the application save command if a save-as-form-data
   workflow is added. The bounded form-data export action is blocked today.
