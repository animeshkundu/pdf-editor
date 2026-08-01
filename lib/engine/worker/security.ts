import type * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../port';
import { withArenaSync, type Arena } from './arena';

export type DocumentEncryptionAlgorithm =
  EngineTypes['DocumentEncryptionSecurity']['algorithm'];

export type DocumentEncryptionSecurity = EngineTypes['DocumentEncryptionSecurity'];

export interface SignatureCoveredRange {
  readonly offset: number;
  readonly length: number;
  readonly end: number;
}

export type SignatureFieldSecurity = EngineTypes['SignatureFieldSecurity'];

export type DocumentSecurityInspection = EngineTypes['DocumentSecurityInspection'];

const SECURITY_LIMITATIONS = [
  'No timestamping',
  'No fresh revocation checking',
  'No long-term validation (LTV)',
] as const;
const MAX_FIELD_DEPTH = 64;
const MAX_FIELD_NODES = 100_000;
const RC4_DISCLOSURE =
  'This PDF uses broken RC4 encryption. It is open for reading only and must be replaced with a full garbage-collecting AES-256 copy before output.';

function nullableNumber(object: mupdf.PDFObject): number | null {
  if (!object.isNumber()) return null;
  const value = object.asNumber();
  return Number.isSafeInteger(value) ? value : null;
}

function objectNumber(object: mupdf.PDFObject): number | null {
  return object.isIndirect() ? object.asIndirect() : null;
}

function encryptionAlgorithm(
  arena: Arena,
  encryption: mupdf.PDFObject,
  version: number | null,
  revision: number | null,
): DocumentEncryptionAlgorithm {
  const filter = arena.keep(encryption.get('Filter'));
  if (filter.isName() && filter.asName() !== 'Standard') return 'unknown';
  if ((revision !== null && revision <= 3) || (version !== null && version <= 2)) return 'rc4';
  if (version === 5 || (revision !== null && revision >= 5)) return 'aes-256';
  if (version !== 4 && revision !== 4) return 'unknown';

  const cryptFilters = arena.keep(encryption.get('CF'));
  if (!cryptFilters.isDictionary()) return 'unknown';
  const streamFilter = arena.keep(encryption.get('StmF'));
  const stringFilter = arena.keep(encryption.get('StrF'));
  const embeddedFilter = arena.keep(encryption.get('EFF'));
  const activeNames = new Set<string>();
  for (const active of [streamFilter, stringFilter, embeddedFilter]) {
    if (active.isName() && active.asName() !== 'Identity') activeNames.add(active.asName());
  }

  const methods = new Set<string>();
  for (const name of activeNames) {
    const definition = arena.keep(cryptFilters.get(name));
    const method = arena.keep(definition.get('CFM'));
    if (method.isName()) methods.add(method.asName());
  }
  if (methods.has('V2')) return 'rc4';
  if (methods.has('AESV3')) return 'aes-256';
  if (methods.has('AESV2')) return 'aes-128';
  return 'unknown';
}

export function inspectDocumentEncryption(
  document: mupdf.PDFDocument,
): DocumentEncryptionSecurity {
  return withArenaSync((arena) => {
    const trailer = arena.keep(document.getTrailer());
    const encryption = arena.keep(trailer.get('Encrypt'));
    if (encryption.isNull()) {
      return {
        protected: false,
        algorithm: 'none',
        version: null,
        revision: null,
        readOnly: false,
      };
    }

    const versionObject = arena.keep(encryption.get('V'));
    const revisionObject = arena.keep(encryption.get('R'));
    const version = nullableNumber(versionObject);
    const revision = nullableNumber(revisionObject);
    const algorithm = encryptionAlgorithm(arena, encryption, version, revision);
    return {
      protected: true,
      algorithm,
      version,
      revision,
      readOnly: algorithm === 'rc4',
      ...(algorithm === 'rc4' ? { disclosure: RC4_DISCLOSURE } : {}),
    };
  });
}

function signatureByteRange(
  arena: Arena,
  value: mupdf.PDFObject,
  sourceByteLength: number | undefined,
): {
  ranges: SignatureCoveredRange[];
  coveredBytes: number;
  signedRevisionEnd: number | null;
  laterBytes: number | null;
  issues: string[];
} {
  const issues: string[] = [];
  const byteRange = arena.keep(value.get('ByteRange'));
  if (!byteRange.isArray()) {
    return {
      ranges: [],
      coveredBytes: 0,
      signedRevisionEnd: null,
      laterBytes: null,
      issues: ['The signature value has no readable /ByteRange array.'],
    };
  }
  if (byteRange.length < 4 || byteRange.length % 2 !== 0) {
    return {
      ranges: [],
      coveredBytes: 0,
      signedRevisionEnd: null,
      laterBytes: null,
      issues: ['/ByteRange must contain at least two offset/length pairs.'],
    };
  }

  const ranges: SignatureCoveredRange[] = [];
  let coveredBytes = 0;
  let previousEnd = 0;
  for (let index = 0; index < byteRange.length; index += 2) {
    const offsetObject = arena.keep(byteRange.get(index));
    const lengthObject = arena.keep(byteRange.get(index + 1));
    const offset = nullableNumber(offsetObject);
    const length = nullableNumber(lengthObject);
    if (offset === null || length === null || offset < 0 || length < 0) {
      issues.push(`/ByteRange pair ${index / 2 + 1} is not a non-negative safe integer pair.`);
      continue;
    }
    const end = offset + length;
    if (!Number.isSafeInteger(end)) {
      issues.push(`/ByteRange pair ${index / 2 + 1} exceeds the safe integer range.`);
      continue;
    }
    if (ranges.length > 0 && offset < previousEnd) {
      issues.push(`/ByteRange pair ${index / 2 + 1} overlaps or precedes the prior range.`);
    }
    if (sourceByteLength !== undefined && end > sourceByteLength) {
      issues.push(`/ByteRange pair ${index / 2 + 1} extends beyond the current file.`);
    }
    ranges.push({ offset, length, end });
    previousEnd = Math.max(previousEnd, end);
    coveredBytes += length;
  }

  if (ranges.length !== byteRange.length / 2 || issues.length > 0) {
    return {
      ranges,
      coveredBytes,
      signedRevisionEnd:
        ranges.length > 0 ? Math.max(...ranges.map((range) => range.end)) : null,
      laterBytes: null,
      issues,
    };
  }

  const signedRevisionEnd = Math.max(...ranges.map((range) => range.end));
  const laterBytes =
    sourceByteLength === undefined ? null : Math.max(0, sourceByteLength - signedRevisionEnd);
  return { ranges, coveredBytes, signedRevisionEnd, laterBytes, issues };
}

interface FieldWalkState {
  nodes: number;
  ordinal: number;
}

function signatureField(
  arena: Arena,
  document: mupdf.PDFDocument,
  field: mupdf.PDFObject,
  name: string,
  documentRevisions: number,
  changeHistoryValidationCode: number | null,
  sourceByteLength: number | undefined,
  ordinal: number,
): SignatureFieldSecurity {
  const value = arena.keep(field.getInheritable('V'));
  let signed = !value.isNull();
  const issues: string[] = [];
  let ranges: SignatureCoveredRange[] = [];
  let coveredBytes = 0;
  let signedRevisionEnd: number | null = null;
  let laterBytes: number | null = null;
  let validByteRange = false;
  try {
    signed = document.signatureIsSigned(field);
  } catch {
    issues.push('The engine could not determine whether this signature field is signed.');
  }
  if (signed && !value.isDictionary()) {
    issues.push('The signature field has a /V value that is not a signature dictionary.');
  } else if (signed) {
    const parsed = signatureByteRange(arena, value, sourceByteLength);
    ranges = parsed.ranges;
    coveredBytes = parsed.coveredBytes;
    signedRevisionEnd = parsed.signedRevisionEnd;
    laterBytes = parsed.laterBytes;
    issues.push(...parsed.issues);
    if (parsed.issues.length === 0) {
      try {
        const engineRanges = document.signatureByteRange(field);
        if (engineRanges.length === 0) {
          throw new Error('The engine returned no covered ranges for a signed field.');
        }
        const validatedRanges = engineRanges.map(({ offset, length }) => {
          const end = offset + length;
          if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            offset < 0 ||
            length < 0 ||
            !Number.isSafeInteger(end)
          ) {
            throw new Error('The engine returned an invalid signature byte range.');
          }
          return { offset, length, end };
        });
        ranges = validatedRanges;
        coveredBytes = validatedRanges.reduce((total, range) => total + range.length, 0);
        signedRevisionEnd = Math.max(...validatedRanges.map((range) => range.end));
        laterBytes =
          sourceByteLength === undefined
            ? null
            : Math.max(0, sourceByteLength - signedRevisionEnd);
        validByteRange = true;
      } catch {
        issues.push('The engine could not expose this signature byte range.');
      }
    }
  }
  let laterChanges = laterBytes === null ? null : laterBytes > 0;
  if (signed && value.isDictionary() && validByteRange) {
    try {
      laterChanges = document.signatureChangedSinceSigning(field);
    } catch {
      issues.push('The engine could not inspect incremental changes after this signature.');
    }
  }
  return {
    name: name || `(unnamed signature field ${ordinal})`,
    fieldObject: objectNumber(field),
    valueObject: signed ? objectNumber(value) : null,
    signed,
    coveredRanges: ranges,
    coveredBytes,
    signedRevisionEnd,
    laterBytes,
    laterChanges,
    documentRevisions,
    changeHistoryValidationCode,
    issues,
  };
}

function walkField(
  arena: Arena,
  document: mupdf.PDFDocument,
  field: mupdf.PDFObject,
  parentName: string,
  inheritedType: string | null,
  depth: number,
  state: FieldWalkState,
  result: SignatureFieldSecurity[],
  documentRevisions: number,
  changeHistoryValidationCode: number | null,
  sourceByteLength: number | undefined,
  seen: Set<number>,
): void {
  if (depth > MAX_FIELD_DEPTH) throw new Error('The AcroForm field tree exceeds 64 levels.');
  state.nodes += 1;
  if (state.nodes > MAX_FIELD_NODES) {
    throw new Error('The AcroForm field tree exceeds 100,000 nodes.');
  }
  const indirect = objectNumber(field);
  if (indirect !== null) {
    if (seen.has(indirect)) return;
    seen.add(indirect);
  }

  const partialName = arena.keep(field.get('T'));
  const ownName = partialName.isString() ? partialName.asString() : '';
  const name = ownName ? (parentName ? `${parentName}.${ownName}` : ownName) : parentName;
  const fieldType = arena.keep(field.get('FT'));
  const effectiveType = fieldType.isName() ? fieldType.asName() : inheritedType;
  const kids = arena.keep(field.get('Kids'));
  const childFields: mupdf.PDFObject[] = [];
  if (kids.isArray()) {
    for (let index = 0; index < kids.length; index += 1) {
      const kid = arena.keep(kids.get(index));
      const subtype = arena.keep(kid.get('Subtype'));
      if (!(subtype.isName() && subtype.asName() === 'Widget')) childFields.push(kid);
    }
  }

  if (childFields.length > 0) {
    for (const child of childFields) {
      walkField(
        arena,
        document,
        child,
        name,
        effectiveType,
        depth + 1,
        state,
        result,
        documentRevisions,
        changeHistoryValidationCode,
        sourceByteLength,
        seen,
      );
    }
  } else if (effectiveType === 'Sig') {
    state.ordinal += 1;
    result.push(
      signatureField(
        arena,
        document,
        field,
        name,
        documentRevisions,
        changeHistoryValidationCode,
        sourceByteLength,
        state.ordinal,
      ),
    );
  }
}

export function inspectSignatureFields(
  document: mupdf.PDFDocument,
  sourceByteLength?: number,
): readonly SignatureFieldSecurity[] {
  return withArenaSync((arena) => {
    const trailer = arena.keep(document.getTrailer());
    const fields = arena.keep(trailer.get('Root', 'AcroForm', 'Fields'));
    if (!fields.isArray()) return [];
    let changeHistoryValidationCode: number | null = null;
    try {
      changeHistoryValidationCode = document.validateChangeHistory();
    } catch {
      // A malformed history is still inspectable at the object level. Null is deliberately
      // distinct from MuPDF's numeric result and is not converted into a validity verdict.
    }
    let documentRevisions = 1;
    try {
      documentRevisions = Math.max(1, document.countVersions());
    } catch {
      // Keep the conservative base revision count while exposing field-level evidence.
    }

    const result: SignatureFieldSecurity[] = [];
    const state: FieldWalkState = { nodes: 0, ordinal: 0 };
    const seen = new Set<number>();
    for (let index = 0; index < fields.length; index += 1) {
      walkField(
        arena,
        document,
        arena.keep(fields.get(index)),
        '',
        null,
        0,
        state,
        result,
        documentRevisions,
        changeHistoryValidationCode,
        sourceByteLength,
        seen,
      );
    }
    const signedCount = result.filter((field) => field.signed).length;
    const engineCount = document.countSignatures();
    return signedCount === engineCount
      ? result
      : result.map((field) =>
          field.signed
            ? {
                ...field,
                issues: [
                  ...field.issues,
                  `The field walk found ${signedCount} signed field(s), while the engine counted ${engineCount}.`,
                ],
              }
            : field,
        );
  });
}

export function inspectDocumentSecurity(
  document: mupdf.PDFDocument,
  sourceByteLength?: number,
): DocumentSecurityInspection {
  return {
    encryption: inspectDocumentEncryption(document),
    signatures: inspectSignatureFields(document, sourceByteLength),
    limitations: SECURITY_LIMITATIONS,
  };
}

export default {
  inspectDocumentEncryption,
  inspectDocumentSecurity,
  inspectSignatureFields,
};
