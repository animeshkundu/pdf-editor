export interface EngineTypes {
  FeatureStatus: 'LOCAL' | 'EQUIV' | 'DEGRADED' | 'EXCLUDED' | 'OPEN';
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
      readonly edit?: boolean;
      readonly form?: boolean;
      readonly assemble?: boolean;
    };
    readonly encryption?: {
      readonly protected: boolean;
      readonly authenticatedAs: 'user' | 'owner';
      readonly algorithm: 'rc4' | 'aes-128' | 'aes-256' | 'unknown';
      readonly readOnly: boolean;
      readonly disclosure?: string;
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
    readonly characters: number;
    readonly analysis: 'complete' | 'inferred' | 'partial';
    readonly limitations: readonly ('form-xobject' | 'structure-tree')[];
  };
  TextSelection: {
    readonly pageIndex: number;
    readonly text: string;
    readonly quads: readonly EngineTypes['PdfQuad'][];
    readonly truncated: boolean;
  };
  ExistingTextEditInput: {
    readonly pageIndex: number;
    readonly originalText: string;
    readonly replacementText: string;
    readonly quads: readonly EngineTypes['PdfQuad'][];
    readonly confirmSignatureInvalidation: boolean;
  };
  ExistingTextEditReport: EngineTypes['MutationResult'] & {
    readonly fidelity: 'LOCAL' | 'DEGRADED';
    readonly analysis: 'inferred' | 'partial';
    readonly limitation?: 'form-xobject';
    readonly fontName: string;
    readonly mechanism: 'content-splice' | 'redaction-overlay';
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
  AnnotationType:
    | 'Text'
    | 'FreeText'
    | 'Line'
    | 'Square'
    | 'Circle'
    | 'Polygon'
    | 'PolyLine'
    | 'Highlight'
    | 'Underline'
    | 'Squiggly'
    | 'StrikeOut'
    | 'Redact'
    | 'Stamp'
    | 'Caret'
    | 'Ink'
    | 'FileAttachment';
  AnnotationLineEnding:
    | 'None'
    | 'Square'
    | 'Circle'
    | 'Diamond'
    | 'OpenArrow'
    | 'ClosedArrow'
    | 'Butt'
    | 'ROpenArrow'
    | 'RClosedArrow'
    | 'Slash';
  AnnotationBorderStyle: 'Solid' | 'Dashed' | 'Beveled' | 'Inset' | 'Underline';
  AnnotationIntent:
    | 'FreeTextCallout'
    | 'FreeTextTypeWriter'
    | 'LineArrow'
    | 'LineDimension'
    | 'PloyLine'
    | 'PolygonCloud'
    | 'PolygonDimension'
    | 'StampImage';
  AnnotationAttachment: {
    readonly name: string;
    readonly mimeType: string;
    readonly data: ArrayBuffer;
  };
  AnnotationState: 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'None';
  AnnotationInput: {
    readonly pageIndex: number;
    readonly type: EngineTypes['AnnotationType'];
    readonly rect: EngineTypes['PdfRect'];
    readonly contents?: string;
    readonly author?: string;
    readonly subject?: string;
    readonly color?: readonly [number, number, number];
    readonly interiorColor?: readonly [number, number, number];
    readonly opacity?: number;
    readonly quadPoints?: readonly EngineTypes['PdfQuad'][];
    readonly inkList?: readonly (readonly EngineTypes['PdfPoint'][])[];
    readonly vertices?: readonly EngineTypes['PdfPoint'][];
    readonly line?: readonly [EngineTypes['PdfPoint'], EngineTypes['PdfPoint']];
    readonly lineEndingStyles?: readonly [
      EngineTypes['AnnotationLineEnding'],
      EngineTypes['AnnotationLineEnding'],
    ];
    readonly borderWidth?: number;
    readonly borderStyle?: EngineTypes['AnnotationBorderStyle'];
    readonly borderDashPattern?: readonly number[];
    readonly borderEffect?: 'None' | 'Cloudy';
    readonly borderEffectIntensity?: number;
    readonly icon?: string;
    readonly intent?: EngineTypes['AnnotationIntent'];
    readonly quadding?: 0 | 1 | 2;
    readonly calloutLine?: readonly EngineTypes['PdfPoint'][];
    readonly stampImage?: ArrayBuffer;
    readonly attachment?: EngineTypes['AnnotationAttachment'];
    readonly replyTo?: {
      readonly pageIndex: number;
      readonly annotationId: number;
    };
    readonly clientId?: string;
    readonly replyToClientId?: string;
    readonly state?: EngineTypes['AnnotationState'];
    readonly flags?: number;
  };
  AnnotationUpdate: {
    readonly rect?: EngineTypes['PdfRect'];
    readonly contents?: string;
    readonly author?: string;
    readonly subject?: string;
    readonly color?: readonly [number, number, number];
    readonly interiorColor?: readonly [number, number, number];
    readonly opacity?: number;
    readonly quadPoints?: readonly EngineTypes['PdfQuad'][];
    readonly inkList?: readonly (readonly EngineTypes['PdfPoint'][])[];
    readonly vertices?: readonly EngineTypes['PdfPoint'][];
    readonly line?: readonly [EngineTypes['PdfPoint'], EngineTypes['PdfPoint']];
    readonly lineEndingStyles?: readonly [
      EngineTypes['AnnotationLineEnding'],
      EngineTypes['AnnotationLineEnding'],
    ];
    readonly borderWidth?: number;
    readonly borderStyle?: EngineTypes['AnnotationBorderStyle'];
    readonly borderDashPattern?: readonly number[];
    readonly borderEffect?: 'None' | 'Cloudy';
    readonly borderEffectIntensity?: number;
    readonly icon?: string;
    readonly intent?: EngineTypes['AnnotationIntent'];
    readonly quadding?: 0 | 1 | 2;
    readonly calloutLine?: readonly EngineTypes['PdfPoint'][];
    readonly stampImage?: ArrayBuffer;
    readonly attachment?: EngineTypes['AnnotationAttachment'];
    readonly state?: EngineTypes['AnnotationState'];
    readonly flags?: number;
  };
  AnnotationInfo: {
    readonly id: number;
    readonly name: string;
    readonly pageIndex: number;
    readonly type: string;
    readonly rect: EngineTypes['PdfRect'];
    readonly contents: string;
    readonly author: string;
    readonly subject: string;
    readonly color: readonly number[];
    readonly opacity: number;
    readonly borderWidth: number;
    readonly borderStyle: string;
    readonly lineEndingStyles: readonly [string, string];
    readonly icon: string;
    readonly state: EngineTypes['AnnotationState'];
    readonly replyToId: number | null;
    readonly flags: number;
  };
  FormFieldInfo: {
    readonly id: number;
    readonly pageIndex: number;
    readonly name: string;
    readonly label: string;
    readonly type: string;
    readonly value: string;
    readonly readOnly: boolean;
    readonly required: boolean;
    readonly multiline: boolean;
    readonly password: boolean;
    readonly options: readonly string[];
    readonly rect: EngineTypes['PdfRect'];
  };
  FormFieldType: 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'button' | 'signature';
  FormFieldInput: {
    readonly pageIndex: number;
    readonly name: string;
    readonly label?: string;
    readonly type: EngineTypes['FormFieldType'];
    readonly rect: EngineTypes['PdfRect'];
    readonly required?: boolean;
    readonly readOnly?: boolean;
    readonly multiline?: boolean;
    readonly password?: boolean;
    readonly comb?: boolean;
    readonly editable?: boolean;
    readonly multiple?: boolean;
    readonly options?: readonly string[];
  };
  FormFieldUpdate: {
    readonly name?: string;
    readonly label?: string;
    readonly rect?: EngineTypes['PdfRect'];
    readonly required?: boolean;
    readonly readOnly?: boolean;
  };
  JavaScriptTrigger: 'keystroke' | 'format' | 'validate' | 'calculate';
  JavaScriptAction: {
    readonly id: string;
    readonly scope: 'document' | 'field';
    readonly name: string;
    readonly source: string;
    readonly fieldName?: string;
    readonly trigger?: EngineTypes['JavaScriptTrigger'];
  };
  JavaScriptActionInput: {
    readonly scope: 'document' | 'field';
    readonly name: string;
    readonly source: string;
    readonly trigger?: EngineTypes['JavaScriptTrigger'];
  };
  JavaScriptActionIdentity: {
    readonly scope: 'document' | 'field';
    readonly name: string;
    readonly trigger?: EngineTypes['JavaScriptTrigger'];
  };
  JavaScriptEvent: {
    readonly type:
      | 'alert'
      | 'print'
      | 'launch-url'
      | 'mail-doc'
      | 'submit'
      | 'exec-menu-item'
      | 'console'
      | 'budget-exhausted';
    readonly detail: string;
    readonly blocked: boolean;
  };
  JavaScriptState: {
    readonly enabled: boolean;
    readonly scripts: readonly EngineTypes['JavaScriptAction'][];
    readonly events: readonly EngineTypes['JavaScriptEvent'][];
  };
  JavaScriptExecutionResult: {
    readonly result: string;
    readonly events: readonly EngineTypes['JavaScriptEvent'][];
    readonly document: EngineTypes['DocumentInfo'];
    readonly journal: EngineTypes['JournalState'];
  };
  JournalState: {
    readonly position: number;
    readonly steps: readonly string[];
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly revision: number;
  };
  MutationResult: {
    readonly document: EngineTypes['DocumentInfo'];
    readonly journal: EngineTypes['JournalState'];
    readonly annotation?: EngineTypes['AnnotationInfo'];
  };
  PdfPermission:
    'print' | 'copy' | 'edit' | 'annotate' | 'form' | 'accessibility' | 'assemble' | 'print-hq';
  SaveOptions: {
    readonly mode: 'full' | 'incremental';
    readonly garbage: 'none' | 'compact' | 'deduplicate' | 'all';
    readonly compress: boolean;
    readonly encrypt: 'keep' | 'none' | 'aes-128' | 'aes-256';
    readonly 'user-password'?: string;
    readonly 'owner-password'?: string;
    readonly permissions?: readonly EngineTypes['PdfPermission'][];
  };
  OutputState: {
    readonly unappliedRedactions: number;
    readonly signatures: number;
    readonly security: EngineTypes['DocumentSecurityInspection'];
    readonly canPersist: boolean;
    readonly persistenceReason?: string;
  };
  ExportedPdf: {
    readonly name: string;
    readonly data: ArrayBuffer;
  };
  PageCompositionItem: {
    readonly source: 'current' | 'incoming';
    readonly pageIndex: number;
  };
  PageBox: 'MediaBox' | 'CropBox' | 'BleedBox' | 'TrimBox' | 'ArtBox';
  PageLabelStyle:
    'none' | 'decimal' | 'roman-upper' | 'roman-lower' | 'alpha-upper' | 'alpha-lower';
  IncomingDocumentInfo: {
    readonly name: string;
    readonly pageCount: number;
    readonly pages: readonly {
      readonly index: number;
      readonly label: string;
    }[];
  };
  CompareResult: {
    readonly incomingName: string;
    readonly same: number;
    readonly changed: number;
    readonly added: number;
    readonly removed: number;
    readonly moved: number;
    readonly truncated: boolean;
    readonly comparedCurrentPages: number;
    readonly comparedIncomingPages: number;
    readonly totalCurrentPages: number;
    readonly totalIncomingPages: number;
    readonly pages: readonly {
      readonly pageIndex: number;
      readonly currentPageIndex?: number;
      readonly status: 'same' | 'changed' | 'moved' | 'inserted' | 'deleted';
      readonly currentLabel?: string;
      readonly incomingLabel?: string;
      readonly currentCharacters: number;
      readonly incomingCharacters: number;
      readonly dimensionsChanged: boolean;
      readonly rasterReviewRecommended: boolean;
      readonly ocrRequired: boolean;
      readonly similarity: number | null;
      readonly textDiff?: {
        readonly insertedWords: number;
        readonly deletedWords: number;
        readonly truncated: boolean;
        readonly runs: readonly {
          readonly type: 'equal' | 'insert' | 'delete';
          readonly text: string;
          readonly words: number;
        }[];
      };
      readonly rasterDiff?: {
        readonly metric: 'rmse';
        readonly rmse: number;
        readonly differentPixelRatio: number;
        readonly maxChannelDelta: number;
        readonly exceedsThreshold: boolean;
        readonly threshold: number;
      };
    }[];
  };
  DocumentEncryptionSecurity: {
    readonly protected: boolean;
    readonly algorithm: 'none' | 'rc4' | 'aes-128' | 'aes-256' | 'unknown';
    readonly version: number | null;
    readonly revision: number | null;
    readonly readOnly: boolean;
    readonly disclosure?: string;
  };
  SignatureFieldSecurity: {
    readonly name: string;
    readonly fieldObject: number | null;
    readonly valueObject: number | null;
    readonly signed: boolean;
    readonly coveredRanges: readonly {
      readonly offset: number;
      readonly length: number;
      readonly end: number;
    }[];
    readonly coveredBytes: number;
    readonly signedRevisionEnd: number | null;
    readonly laterBytes: number | null;
    readonly laterChanges: boolean | null;
    readonly documentRevisions: number;
    readonly changeHistoryValidationCode: number | null;
    readonly issues: readonly string[];
  };
  DocumentSecurityInspection: {
    readonly encryption: EngineTypes['DocumentEncryptionSecurity'];
    readonly signatures: readonly EngineTypes['SignatureFieldSecurity'][];
    readonly limitations: readonly [
      'No timestamping',
      'No fresh revocation checking',
      'No long-term validation (LTV)',
    ];
  };
  PdfAReport: {
    readonly profile: string | null;
    readonly valid: boolean;
    readonly checks: readonly {
      readonly id: string;
      readonly label: string;
      readonly passed: boolean;
      readonly detail: string;
    }[];
  };
  ApplyRedactionsReport: {
    readonly data: ArrayBuffer;
    readonly document: EngineTypes['DocumentInfo'];
    readonly journal: EngineTypes['JournalState'];
    readonly fidelity: 'DEGRADED';
    readonly applied: number;
    readonly pages: number;
  };
  SanitizeReport: {
    readonly data: ArrayBuffer;
    readonly document: EngineTypes['DocumentInfo'];
    readonly journal: EngineTypes['JournalState'];
    readonly removed: {
      readonly scripts: number;
      readonly embeddedFiles: number;
      readonly metadata: number;
      readonly formValues: number;
      readonly hiddenAnnotations: number;
      readonly pages: number;
    };
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
    listAnnotations(pageIndex?: number): Promise<readonly EngineTypes['AnnotationInfo'][]>;
    addAnnotation(
      input: EngineTypes['AnnotationInput'],
    ): Promise<EngineTypes['MutationResult']>;
    editExistingText(
      input: EngineTypes['ExistingTextEditInput'],
    ): Promise<EngineTypes['ExistingTextEditReport']>;
    addAnnotations(
      inputs: readonly EngineTypes['AnnotationInput'][],
    ): Promise<EngineTypes['MutationResult']>;
    updateAnnotation(
      pageIndex: number,
      annotationId: number,
      changes: EngineTypes['AnnotationUpdate'],
    ): Promise<EngineTypes['MutationResult']>;
    deleteAnnotation(
      pageIndex: number,
      annotationId: number,
    ): Promise<EngineTypes['MutationResult']>;
    reorderPages(order: readonly number[]): Promise<EngineTypes['MutationResult']>;
    rotatePages(
      pageIndices: readonly number[],
      degrees: 90 | 180 | 270 | -90 | -180 | -270,
    ): Promise<EngineTypes['MutationResult']>;
    insertBlankPage(
      at: number,
      size?: EngineTypes['PdfRect'],
    ): Promise<EngineTypes['MutationResult']>;
    deletePages(pageIndices: readonly number[]): Promise<EngineTypes['MutationResult']>;
    setPageBoxes(
      pageIndices: readonly number[],
      box: EngineTypes['PageBox'],
      rect: EngineTypes['PdfRect'],
    ): Promise<EngineTypes['MutationResult']>;
    setPageLabels(
      at: number,
      style: EngineTypes['PageLabelStyle'],
      prefix: string,
      start: number,
    ): Promise<EngineTypes['MutationResult']>;
    extractPages(
      pageIndices: readonly number[],
      deleteOriginals?: boolean,
    ): Promise<EngineTypes['ExportedPdf']>;
    mergeDocument(
      name: string,
      data: ArrayBuffer,
      insertAt: number,
      sourcePages?: readonly number[],
    ): Promise<EngineTypes['MutationResult']>;
    composePages(
      name: string,
      order: readonly EngineTypes['PageCompositionItem'][],
      data?: ArrayBuffer,
    ): Promise<EngineTypes['MutationResult']>;
    inspectIncomingDocument(
      name: string,
      data: ArrayBuffer,
    ): Promise<EngineTypes['IncomingDocumentInfo']>;
    compareDocument(name: string, data: ArrayBuffer): Promise<EngineTypes['CompareResult']>;
    validatePdfA(): Promise<EngineTypes['PdfAReport']>;
    splitDocument(
      ranges: readonly (readonly [number, number])[],
    ): Promise<readonly EngineTypes['ExportedPdf'][]>;
    listFields(): Promise<readonly EngineTypes['FormFieldInfo'][]>;
    setFieldValue(
      name: string,
      value: string | boolean,
    ): Promise<EngineTypes['MutationResult']>;
    setFieldValues(
      values: Readonly<Record<string, string | boolean>>,
    ): Promise<EngineTypes['MutationResult']>;
    createFormField(
      input: EngineTypes['FormFieldInput'],
    ): Promise<EngineTypes['MutationResult']>;
    updateFormField(
      name: string,
      changes: EngineTypes['FormFieldUpdate'],
    ): Promise<EngineTypes['MutationResult']>;
    updateFormFields(
      updates: readonly {
        readonly name: string;
        readonly changes: EngineTypes['FormFieldUpdate'];
      }[],
    ): Promise<EngineTypes['MutationResult']>;
    reorderFormFields(names: readonly string[]): Promise<EngineTypes['MutationResult']>;
    resetForm(): Promise<EngineTypes['MutationResult']>;
    getJavaScriptState(): Promise<EngineTypes['JavaScriptState']>;
    setJavaScriptAction(
      input: EngineTypes['JavaScriptActionInput'],
    ): Promise<EngineTypes['MutationResult']>;
    deleteJavaScriptAction(
      input: EngineTypes['JavaScriptActionIdentity'],
    ): Promise<EngineTypes['MutationResult']>;
    executeJavaScript(source: string): Promise<EngineTypes['JavaScriptExecutionResult']>;
    authenticateOwner(password: string): Promise<EngineTypes['DocumentInfo']>;
    updateMetadata(
      values: Readonly<
        Partial<Record<'title' | 'author' | 'subject' | 'keywords' | 'language', string>>
      >,
    ): Promise<EngineTypes['MutationResult']>;
    save(options: EngineTypes['SaveOptions']): Promise<ArrayBuffer>;
    exportPdf(options: EngineTypes['SaveOptions']): Promise<ArrayBuffer>;
    applyRedactions(
      confirmSignatureInvalidation: boolean,
    ): Promise<EngineTypes['ApplyRedactionsReport']>;
    redactPages(
      pageIndices: readonly number[],
      confirmSignatureInvalidation: boolean,
    ): Promise<EngineTypes['SanitizeReport']>;
    sanitize(confirmSignatureInvalidation: boolean): Promise<EngineTypes['SanitizeReport']>;
    undo(): Promise<EngineTypes['MutationResult']>;
    redo(): Promise<EngineTypes['MutationResult']>;
    getJournal(): Promise<EngineTypes['JournalState']>;
    getOutputState(): Promise<EngineTypes['OutputState']>;
    subscribe(listener: (event: EngineTypes['EngineEvent']) => void): () => void;
    close(): Promise<void>;
  };
  PdfEngineFactory: (
    file: File,
    signal?: AbortSignal,
    password?: string,
  ) => Promise<EngineTypes['PdfEngine']>;
  EngineRequest:
    | {
        readonly id: number;
        readonly operation: 'open';
        readonly payload: {
          readonly name: string;
          readonly data: ArrayBuffer;
          readonly ios: boolean;
          readonly persistenceKey?: string;
          readonly password?: string;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'authenticateOwner';
        readonly payload: { readonly password: string };
      }
    | {
        readonly id: number;
        readonly operation: 'getDocumentInfo' | 'snapshotForSearch';
        readonly payload: Record<string, never>;
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
        readonly operation: 'listAnnotations';
        readonly payload: { readonly pageIndex?: number };
      }
    | {
        readonly id: number;
        readonly operation: 'addAnnotation';
        readonly payload: EngineTypes['AnnotationInput'];
      }
    | {
        readonly id: number;
        readonly operation: 'editExistingText';
        readonly payload: EngineTypes['ExistingTextEditInput'];
      }
    | {
        readonly id: number;
        readonly operation: 'addAnnotations';
        readonly payload: { readonly inputs: readonly EngineTypes['AnnotationInput'][] };
      }
    | {
        readonly id: number;
        readonly operation: 'updateAnnotation';
        readonly payload: {
          readonly pageIndex: number;
          readonly annotationId: number;
          readonly changes: EngineTypes['AnnotationUpdate'];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'deleteAnnotation';
        readonly payload: { readonly pageIndex: number; readonly annotationId: number };
      }
    | {
        readonly id: number;
        readonly operation: 'reorderPages';
        readonly payload: { readonly order: readonly number[] };
      }
    | {
        readonly id: number;
        readonly operation: 'rotatePages';
        readonly payload: {
          readonly pageIndices: readonly number[];
          readonly degrees: 90 | 180 | 270 | -90 | -180 | -270;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'insertBlankPage';
        readonly payload: { readonly at: number; readonly size?: EngineTypes['PdfRect'] };
      }
    | {
        readonly id: number;
        readonly operation: 'deletePages';
        readonly payload: { readonly pageIndices: readonly number[] };
      }
    | {
        readonly id: number;
        readonly operation: 'setPageBoxes';
        readonly payload: {
          readonly pageIndices: readonly number[];
          readonly box: EngineTypes['PageBox'];
          readonly rect: EngineTypes['PdfRect'];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'setPageLabels';
        readonly payload: {
          readonly at: number;
          readonly style: EngineTypes['PageLabelStyle'];
          readonly prefix: string;
          readonly start: number;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'extractPages';
        readonly payload: {
          readonly pageIndices: readonly number[];
          readonly deleteOriginals: boolean;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'mergeDocument';
        readonly payload: {
          readonly name: string;
          readonly data: ArrayBuffer;
          readonly insertAt: number;
          readonly sourcePages?: readonly number[];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'composePages';
        readonly payload: {
          readonly name: string;
          readonly order: readonly EngineTypes['PageCompositionItem'][];
          readonly data?: ArrayBuffer;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'inspectIncomingDocument';
        readonly payload: {
          readonly name: string;
          readonly data: ArrayBuffer;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'compareDocument';
        readonly payload: {
          readonly name: string;
          readonly data: ArrayBuffer;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'validatePdfA';
        readonly payload: Record<string, never>;
      }
    | {
        readonly id: number;
        readonly operation: 'splitDocument';
        readonly payload: { readonly ranges: readonly (readonly [number, number])[] };
      }
    | {
        readonly id: number;
        readonly operation: 'listFields';
        readonly payload: Record<string, never>;
      }
    | {
        readonly id: number;
        readonly operation: 'setFieldValue';
        readonly payload: { readonly name: string; readonly value: string | boolean };
      }
    | {
        readonly id: number;
        readonly operation: 'setFieldValues';
        readonly payload: {
          readonly values: Readonly<Record<string, string | boolean>>;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'createFormField';
        readonly payload: EngineTypes['FormFieldInput'];
      }
    | {
        readonly id: number;
        readonly operation: 'updateFormField';
        readonly payload: {
          readonly name: string;
          readonly changes: EngineTypes['FormFieldUpdate'];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'updateFormFields';
        readonly payload: {
          readonly updates: readonly {
            readonly name: string;
            readonly changes: EngineTypes['FormFieldUpdate'];
          }[];
        };
      }
    | {
        readonly id: number;
        readonly operation: 'reorderFormFields';
        readonly payload: { readonly names: readonly string[] };
      }
    | {
        readonly id: number;
        readonly operation: 'resetForm';
        readonly payload: Record<string, never>;
      }
    | {
        readonly id: number;
        readonly operation: 'getJavaScriptState';
        readonly payload: Record<string, never>;
      }
    | {
        readonly id: number;
        readonly operation: 'setJavaScriptAction';
        readonly payload: EngineTypes['JavaScriptActionInput'];
      }
    | {
        readonly id: number;
        readonly operation: 'deleteJavaScriptAction';
        readonly payload: EngineTypes['JavaScriptActionIdentity'];
      }
    | {
        readonly id: number;
        readonly operation: 'executeJavaScript';
        readonly payload: { readonly source: string };
      }
    | {
        readonly id: number;
        readonly operation: 'updateMetadata';
        readonly payload: {
          readonly values: Readonly<
            Partial<Record<'title' | 'author' | 'subject' | 'keywords' | 'language', string>>
          >;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'save' | 'exportPdf';
        readonly payload: EngineTypes['SaveOptions'];
      }
    | {
        readonly id: number;
        readonly operation: 'applyRedactions';
        readonly payload: { readonly confirmSignatureInvalidation: boolean };
      }
    | {
        readonly id: number;
        readonly operation: 'redactPages';
        readonly payload: {
          readonly pageIndices: readonly number[];
          readonly confirmSignatureInvalidation: boolean;
        };
      }
    | {
        readonly id: number;
        readonly operation: 'sanitize';
        readonly payload: { readonly confirmSignatureInvalidation: boolean };
      }
    | {
        readonly id: number;
        readonly operation: 'undo' | 'redo' | 'getJournal' | 'getOutputState';
        readonly payload: Record<string, never>;
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
    | readonly EngineTypes['AnnotationInfo'][]
    | readonly EngineTypes['FormFieldInfo'][]
    | EngineTypes['MutationResult']
    | EngineTypes['ExistingTextEditReport']
    | EngineTypes['JournalState']
    | EngineTypes['OutputState']
    | EngineTypes['ExportedPdf']
    | EngineTypes['IncomingDocumentInfo']
    | EngineTypes['CompareResult']
    | EngineTypes['PdfAReport']
    | EngineTypes['JavaScriptState']
    | EngineTypes['JavaScriptExecutionResult']
    | readonly EngineTypes['ExportedPdf'][]
    | EngineTypes['ApplyRedactionsReport']
    | EngineTypes['SanitizeReport']
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
  EngineEvent:
    | {
        readonly event: 'persistence-error';
        readonly message: string;
      }
    | {
        readonly event: 'javascript-disabled';
        readonly message: string;
      }
    | {
        readonly event: 'persistence-status';
        readonly available: boolean;
        readonly reason?: string;
      };
  WorkerMessage: EngineTypes['EngineResponse'] | EngineTypes['EngineEvent'];
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
