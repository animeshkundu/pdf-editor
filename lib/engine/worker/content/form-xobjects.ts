import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { Arena } from '../arena';

// Form XObject instancing proof for the byte-span splicing mechanism.
//
// A Form XObject's content stream is a single shared object that can be drawn by any number
// of `Do` operators, on any number of pages, at any number of transforms. Splicing its bytes
// directly is safe only when it is drawn in exactly one place, because a shared stream edited
// for one placement silently edits every other placement too. ADR 0020 withdrew content-
// stream rewriting generally; this module does not reopen that question for the ordinary
// multi-instance case. It only recognises the narrow case the withdrawal did not need to
// cover: a Form XObject this mechanism can prove, by counting every `Do` invocation the
// engine's own resolved operator trace records across the whole document, is drawn exactly
// once. Anything it cannot prove that about is refused, not approximated.
//
// The count comes from `PDFPage.processContents()` (ADR 0004's `js_processor`), which
// resolves each `Do_form` operator to the actual `pdf_obj` it invoked
// (`js_proc_Do_form` in `mupdf-js-processor.c`), so this does not need to re-derive resource
// lookup or inheritance itself.
//
// Known limitation, stated rather than hidden: this counts `Do_form` invocations recorded
// directly on each page's own content stream. A form that is itself drawn from inside another
// form (nested `Do`) is not descended into, so a form reachable only through such nesting will
// be undercounted. See docs/research/2026-08-01-byte-span-content-splicing.md.

export interface FormInstancing {
  readonly referenceCount: number;
  readonly provenSingleInstance: boolean;
}

function isFormRecord(record: mupdf.PDFOperatorRecord): boolean {
  return record.operator === 'Do_form';
}

/**
 * Counts every `Do` invocation, across every page of `document`, that resolves to the exact
 * indirect object `formObjectNumber`.
 */
export function countFormXObjectInstances(
  arena: Arena,
  document: mupdf.PDFDocument,
  formObjectNumber: number,
): number {
  let count = 0;
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    const trace = arena.keep(page.processContents());
    for (const record of trace.getRecords()) {
      if (!isFormRecord(record)) continue;
      const handle = record.handles[0];
      if (!(handle instanceof mupdf.PDFObject)) continue;
      if (handle.isIndirect() && handle.asIndirect() === formObjectNumber) count += 1;
    }
  }
  return count;
}

/**
 * Proves (or refuses to prove) that `formObject` is safe to splice directly, i.e. that it is
 * drawn in exactly one place in the whole document. Throws with an explicit refusal message
 * naming the measured count when it cannot: zero means the form is never actually drawn (so
 * editing it would change nothing a reader sees, which is its own kind of dishonest), and more
 * than one means the shared stream has multiple placements this mechanism cannot edit safely.
 */
export function proveSingleFormInstance(
  arena: Arena,
  document: mupdf.PDFDocument,
  formObject: mupdf.PDFObject,
): FormInstancing {
  if (!formObject.isIndirect()) {
    throw new Error(
      'Content-stream byte splicing refuses a Form XObject that is not an indirect reference, because instancing cannot be counted for an object with no object number.',
    );
  }
  const formObjectNumber = formObject.asIndirect();
  const referenceCount = countFormXObjectInstances(arena, document, formObjectNumber);
  if (referenceCount !== 1) {
    throw new Error(
      `Content-stream byte splicing refuses this Form XObject because it is drawn ${referenceCount} time(s) across the document, not exactly once; instancing cannot be proven safe to edit directly.`,
    );
  }
  return { referenceCount, provenSingleInstance: true };
}

export default { countFormXObjectInstances, proveSingleFormInstance };
