import { assertPartitionsExactly, scanContentTokens, type ContentToken } from './tokens';

export interface ContentTokenSummary {
  readonly bytes: number;
  readonly tokens: number;
  readonly significantTokens: number;
  readonly signatures: readonly string[];
  readonly keywords: Readonly<Record<string, number>>;
}

export interface ContentStreamTokenDiff {
  readonly beforeStreams: number;
  readonly afterStreams: number;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly commonPrefixTokens: number;
  readonly commonSuffixTokens: number;
  readonly changedBeforeTokens: number;
  readonly changedAfterTokens: number;
  readonly keywordDelta: Readonly<Record<string, number>>;
  readonly firstBeforeChanges: readonly string[];
  readonly firstAfterChanges: readonly string[];
}

const decoder = new TextDecoder('latin1');

function hashBytes(bytes: Uint8Array, token: ContentToken): string {
  let hash = 0x811c9dc5;
  for (let index = token.start; index < token.end; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function tokenSignature(bytes: Uint8Array, token: ContentToken): string {
  const length = token.end - token.start;
  if (
    token.kind === 'inline-image-data' ||
    token.kind === 'string' ||
    token.kind === 'hex-string' ||
    token.kind === 'array' ||
    token.kind === 'dictionary'
  ) {
    return `${token.kind}:${length}:${hashBytes(bytes, token)}`;
  }
  const text = decoder.decode(bytes.subarray(token.start, token.end));
  return `${token.kind}:${text}`;
}

export function summarizeContentTokens(bytes: Uint8Array): ContentTokenSummary {
  const tokens = scanContentTokens(bytes);
  assertPartitionsExactly(tokens, bytes);
  const significant = tokens.filter(
    (token) => token.kind !== 'whitespace' && token.kind !== 'comment',
  );
  const keywords: Record<string, number> = {};
  for (const token of significant) {
    if (token.kind !== 'keyword') continue;
    const keyword = decoder.decode(bytes.subarray(token.start, token.end));
    keywords[keyword] = (keywords[keyword] ?? 0) + 1;
  }
  return {
    bytes: bytes.length,
    tokens: tokens.length,
    significantTokens: significant.length,
    signatures: significant.map((token) => tokenSignature(bytes, token)),
    keywords,
  };
}

function streamSignatures(streams: readonly Uint8Array[]): {
  readonly summaries: readonly ContentTokenSummary[];
  readonly signatures: readonly string[];
} {
  const summaries = streams.map(summarizeContentTokens);
  const signatures = summaries.flatMap((summary, index) => [
    ...(index === 0 ? [] : [`stream-boundary:${index}`]),
    ...summary.signatures,
  ]);
  return { summaries, signatures };
}

export function diffContentStreams(
  before: readonly Uint8Array[],
  after: readonly Uint8Array[],
): ContentStreamTokenDiff {
  const beforeSummary = streamSignatures(before);
  const afterSummary = streamSignatures(after);
  let commonPrefixTokens = 0;
  const sharedLength = Math.min(
    beforeSummary.signatures.length,
    afterSummary.signatures.length,
  );
  while (
    commonPrefixTokens < sharedLength &&
    beforeSummary.signatures[commonPrefixTokens] === afterSummary.signatures[commonPrefixTokens]
  ) {
    commonPrefixTokens += 1;
  }

  let commonSuffixTokens = 0;
  while (
    commonSuffixTokens < sharedLength - commonPrefixTokens &&
    beforeSummary.signatures[beforeSummary.signatures.length - 1 - commonSuffixTokens] ===
      afterSummary.signatures[afterSummary.signatures.length - 1 - commonSuffixTokens]
  ) {
    commonSuffixTokens += 1;
  }

  const beforeKeywords: Record<string, number> = {};
  const afterKeywords: Record<string, number> = {};
  for (const summary of beforeSummary.summaries) {
    for (const [keyword, count] of Object.entries(summary.keywords)) {
      beforeKeywords[keyword] = (beforeKeywords[keyword] ?? 0) + count;
    }
  }
  for (const summary of afterSummary.summaries) {
    for (const [keyword, count] of Object.entries(summary.keywords)) {
      afterKeywords[keyword] = (afterKeywords[keyword] ?? 0) + count;
    }
  }
  const keywordDelta: Record<string, number> = {};
  for (const keyword of new Set([
    ...Object.keys(beforeKeywords),
    ...Object.keys(afterKeywords),
  ])) {
    const delta = (afterKeywords[keyword] ?? 0) - (beforeKeywords[keyword] ?? 0);
    if (delta !== 0) keywordDelta[keyword] = delta;
  }

  const beforeChangeEnd = beforeSummary.signatures.length - commonSuffixTokens;
  const afterChangeEnd = afterSummary.signatures.length - commonSuffixTokens;
  return {
    beforeStreams: before.length,
    afterStreams: after.length,
    beforeBytes: before.reduce((total, stream) => total + stream.length, 0),
    afterBytes: after.reduce((total, stream) => total + stream.length, 0),
    beforeTokens: beforeSummary.signatures.length,
    afterTokens: afterSummary.signatures.length,
    commonPrefixTokens,
    commonSuffixTokens,
    changedBeforeTokens: Math.max(0, beforeChangeEnd - commonPrefixTokens),
    changedAfterTokens: Math.max(0, afterChangeEnd - commonPrefixTokens),
    keywordDelta,
    firstBeforeChanges: beforeSummary.signatures.slice(
      commonPrefixTokens,
      Math.min(beforeChangeEnd, commonPrefixTokens + 12),
    ),
    firstAfterChanges: afterSummary.signatures.slice(
      commonPrefixTokens,
      Math.min(afterChangeEnd, commonPrefixTokens + 12),
    ),
  };
}

export default { diffContentStreams, summarizeContentTokens };
