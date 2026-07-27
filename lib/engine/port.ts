export interface EngineTypes {
  PdfRect: readonly [number, number, number, number];
  PdfPoint: readonly [number, number];
  PdfQuad: readonly [number, number, number, number, number, number, number, number];
  PageInfo: {
    readonly index: number;
    readonly label: string;
    readonly bounds: EngineTypes['PdfRect'];
    readonly width: number;
    readonly height: number;
  };
  OutlineNode: {
    readonly title: string;
    readonly pageIndex: number | null;
    readonly children: readonly EngineTypes['OutlineNode'][];
  };
  AttachmentInfo: {
    readonly id: string;
    readonly filename: string;
    readonly mimeType: string;
  };
  DocumentInfo: {
    readonly name: string;
    readonly title: string;
    readonly pages: readonly EngineTypes['PageInfo'][];
    readonly outline: readonly EngineTypes['OutlineNode'][];
    readonly attachments: readonly EngineTypes['AttachmentInfo'][];
    readonly permissions: {
      readonly copy: boolean;
      readonly print: boolean;
      readonly annotate: boolean;
    };
  };
  TileRequest: {
    readonly pageIndex: number;
    readonly scale: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly priority?: number;
  };
  TileResult: {
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly pixels: ArrayBuffer;
  };
  PageText: {
    readonly pageIndex: number;
    readonly text: string;
    readonly analysis: 'complete' | 'inferred' | 'partial';
    readonly limitations: readonly ('form-xobject' | 'structure-tree')[];
  };
  TextSelection: {
    readonly pageIndex: number;
    readonly text: string;
    readonly quads: readonly EngineTypes['PdfQuad'][];
    readonly truncated: boolean;
  };
  SearchHit: {
    readonly pageIndex: number;
    readonly pageLabel: string;
    readonly quads: readonly EngineTypes['PdfQuad'][];
  };
  SearchResult: {
    readonly hits: readonly EngineTypes['SearchHit'][];
    readonly truncated: boolean;
  };
  PdfEngine: {
    readonly info: EngineTypes['DocumentInfo'];
    renderTile(
      request: EngineTypes['TileRequest'],
      signal?: AbortSignal,
    ): Promise<EngineTypes['TileResult']>;
    getPageText(pageIndex: number, signal?: AbortSignal): Promise<EngineTypes['PageText']>;
    selectText(
      pageIndex: number,
      start: EngineTypes['PdfPoint'],
      end: EngineTypes['PdfPoint'],
      signal?: AbortSignal,
    ): Promise<EngineTypes['TextSelection']>;
    search(query: string, signal?: AbortSignal): Promise<EngineTypes['SearchResult']>;
    readAttachment(id: string, signal?: AbortSignal): Promise<ArrayBuffer>;
    close(): Promise<void>;
  };
  PdfEngineFactory: (file: File, signal?: AbortSignal) => Promise<EngineTypes['PdfEngine']>;
  EngineRequest:
    | {
        readonly id: number;
        readonly operation: 'open';
        readonly payload: {
          readonly name: string;
          readonly data: ArrayBuffer;
          readonly ios: boolean;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'renderTile';
        readonly payload: EngineTypes['TileRequest'];
      }
    | {
        readonly id: number;
        readonly operation: 'getPageText';
        readonly payload: { readonly pageIndex: number };
      }
    | {
        readonly id: number;
        readonly operation: 'selectText';
        readonly payload: {
          readonly pageIndex: number;
          readonly start: EngineTypes['PdfPoint'];
          readonly end: EngineTypes['PdfPoint'];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'getOutline' | 'getAttachments' | 'close';
        readonly payload: Record<string, never>;
      }
    | {
        readonly id: number;
        readonly operation: 'readAttachment';
        readonly payload: { readonly id: string };
      }
    | {
        readonly id: number;
        readonly operation: 'search';
        readonly payload: { readonly query: string };
      }
    | {
        readonly id: number;
        readonly operation: 'cancel';
        readonly payload: { readonly requestId: number };
      };
  SerializedEngineError: {
    readonly name: string;
    readonly code: string;
    readonly message: string;
  };
  EngineResponseValue:
    | undefined
    | EngineTypes['DocumentInfo']
    | EngineTypes['TileResult']
    | EngineTypes['PageText']
    | EngineTypes['TextSelection']
    | EngineTypes['SearchResult']
    | readonly EngineTypes['OutlineNode'][]
    | readonly EngineTypes['AttachmentInfo'][]
    | ArrayBuffer;
  EngineResponse:
    | {
        readonly id: number;
        readonly ok: true;
        readonly value: EngineTypes['EngineResponseValue'];
      }
    | {
        readonly id: number;
        readonly ok: false;
        readonly error: EngineTypes['SerializedEngineError'];
      };
}

class WorkerCrashedError extends Error {
  constructor(
    message = 'The document engine stopped. Reopen the document to continue.',
    readonly code: 'worker_crashed' | 'engine_closed' = 'worker_crashed',
  ) {
    super(message);
    this.name = 'WorkerCrashedError';
  }
}

class EngineRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }
}

export default { EngineRequestError, WorkerCrashedError };
