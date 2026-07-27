import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { DESKTOP_BUDGET, IOS_BUDGET, assertFileSize, assertPageCount } from '../../core/limits';
import type { EngineTypes } from '../port';
import workerRuntime from './arena';

type EngineRequest = EngineTypes['EngineRequest'];
type SearchHit = EngineTypes['SearchHit'];
type SearchResult = EngineTypes['SearchResult'];
const { postFailure, postSuccess, releaseRetained, retain, retained, withArena } =
  workerRuntime;
const scope = self as unknown as Parameters<typeof postSuccess>[0];
const DOCUMENT_KEY = 'search-document:active';
const cancelled = new Set<number>();

function activeDocument(): mupdf.Document {
  return retained<mupdf.Document>(DOCUMENT_KEY);
}

function openDocument(payload: Extract<EngineRequest, { operation: 'open' }>['payload']): void {
  const budget = payload.ios ? IOS_BUDGET : DESKTOP_BUDGET;
  assertFileSize(payload.data.byteLength, budget);
  releaseRetained();
  const input = new Uint8Array(payload.data);
  const document = retain(DOCUMENT_KEY, mupdf.Document.openDocument(input, 'application/pdf'));
  try {
    assertPageCount(document.countPages(), budget);
  } catch (error) {
    releaseRetained();
    throw error;
  }
}

const MAX_SEARCH_HITS = 1_000;
const MAX_SEARCH_QUADS_PER_PAGE = 16_384;

async function search(requestId: number, query: string): Promise<SearchResult | null> {
  if (!query.trim()) return { hits: [], truncated: false };
  const document = activeDocument();
  const hits: SearchHit[] = [];
  let truncated = false;
  const pageCount = document.countPages();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (cancelled.delete(requestId)) return null;
    const remaining = Math.max(0, MAX_SEARCH_HITS - hits.length);
    const quadLimit =
      remaining === 0
        ? 1
        : Math.min(MAX_SEARCH_QUADS_PER_PAGE, Math.max(256, (remaining + 1) * 8));
    const pageHits = await withArena((arena) => {
      const page = arena.keep(document.loadPage(pageIndex));
      return {
        label: page.getLabel() || String(pageIndex + 1),
        matches: page.search(query, quadLimit),
      };
    });
    const rawQuadCount = pageHits.matches.reduce((count, quads) => count + quads.length, 0);
    const saturated = rawQuadCount >= quadLimit;
    const completeMatches = saturated ? pageHits.matches.slice(0, -1) : pageHits.matches;
    if (saturated || completeMatches.length > remaining) truncated = true;
    for (const quads of completeMatches.slice(0, remaining)) {
      hits.push({ pageIndex, pageLabel: pageHits.label, quads });
    }
    if (pageIndex % 4 === 3) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { hits, truncated };
}

scope.addEventListener('message', (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  if (request.operation === 'cancel') {
    cancelled.add(request.payload.requestId);
    return;
  }

  void (async () => {
    try {
      if (request.operation === 'open') {
        openDocument(request.payload);
        postSuccess(scope, request.id, undefined);
      } else if (request.operation === 'search') {
        const result = await search(request.id, request.payload.query);
        if (result) postSuccess(scope, request.id, result);
      } else if (request.operation === 'close') {
        releaseRetained();
        postSuccess(scope, request.id, undefined);
      } else {
        throw new Error(
          `Operation "${request.operation}" is not available in the search worker.`,
        );
      }
    } catch (error) {
      postFailure(scope, request.id, error);
    }
  })();
});

postSuccess(scope, 0, undefined);
