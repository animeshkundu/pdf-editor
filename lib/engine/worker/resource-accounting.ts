import type * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { persistenceSnapshot } from './save';

// MuPDF defines PDF_JS_LIMIT_MEMORY as (100 << 20) in source/pdf/pdf-js.c. The limit is
// per JS context, and all actions in a document share that context, so script count cannot
// multiply this reserve. Normal mutations use one context; console evaluation clones the
// PDF and temporarily owns a second context.
export const JAVASCRIPT_CONTEXT_MEMORY_LIMIT = 100 << 20;

export function javaScriptContextProjection(hasScripts: boolean): number {
  return hasScripts ? JAVASCRIPT_CONTEXT_MEMORY_LIMIT : 0;
}

export class DocumentSizeAccounting {
  #bytes = 0;

  get bytes(): number {
    return this.#bytes;
  }

  reset(bytes: number): void {
    this.#bytes = bytes;
  }

  refresh(document: mupdf.PDFDocument): void {
    // A garbage-collected snapshot measures the current reachable document after mutation,
    // undo, redo, deletion, or rollback. Accumulated projections never repay journal
    // reversals and eventually deny every operation in a long editing session.
    this.#bytes = persistenceSnapshot(document).byteLength;
  }
}

export default {
  DocumentSizeAccounting,
  JAVASCRIPT_CONTEXT_MEMORY_LIMIT,
  javaScriptContextProjection,
};
