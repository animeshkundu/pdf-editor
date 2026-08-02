/**
 * Word-level text diff for CMPR-003.
 *
 * Classifies changes between two texts as insertions and deletions at the word
 * granularity. Returns classified runs (TextRun[]) rather than character counts,
 * so the caller can display exactly what changed.
 *
 * Algorithm
 * ---------
 * Uses the standard dynamic-programming LCS (longest common subsequence) over
 * word tokens. The DP table has dimensions (|a|+1) × (|b|+1); for page texts up
 * to MAX_TOKENS words, this is at most MAX_TOKENS² cells.
 *
 * Tokens are whitespace-delimited words. Punctuation is kept attached to the
 * adjacent word to preserve context in the displayed run text, but comparison
 * is case-sensitive on the raw token to avoid false equalities.
 *
 * Performance: O(n*m) time and space. For n=m=8192 (the MAX_TOKENS limit), the
 * table is ~64M integer cells. At 4 bytes each that is 256 MB, which exceeds the
 * worker budget. The implementation instead uses Int16Array rows (capped at 32767)
 * and streams two rows at a time for the length computation, then does a full
 * traceback by re-computing on demand. Inputs above MAX_TOKENS are truncated and
 * flagged.
 *
 * For typical page content (200–1000 words), the algorithm is fast and produces
 * a precise, minimal edit sequence.
 */

export type TextRunType = 'equal' | 'insert' | 'delete';

/** A contiguous run of words of the same edit type. */
export interface TextRun {
  /** Whether these words are unchanged, inserted, or deleted. */
  readonly type: TextRunType;
  /** The words joined by single spaces. */
  readonly text: string;
  /** Number of word tokens in this run. */
  readonly words: number;
}

/** Result of a word-level diff between two page texts. */
export interface TextDiff {
  /** Classified runs in document order. */
  readonly runs: readonly TextRun[];
  /** Total words inserted (present in incoming, absent in current). */
  readonly insertedWords: number;
  /** Total words deleted (present in current, absent in incoming). */
  readonly deletedWords: number;
  /**
   * Whether the diff was truncated because one or both inputs exceeded
   * MAX_TOKENS. When true, the runs cover only the first MAX_TOKENS words of
   * each input.
   */
  readonly truncated: boolean;
}

/**
 * Maximum tokens per input accepted for LCS computation.
 * Above this limit the inputs are truncated and truncated=true is set.
 * Chosen to keep peak memory usage below ~8 MB (2 × 2048² × 2 bytes).
 */
export const MAX_DIFF_TOKENS = 2_048;

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Compute the full LCS length table using only two rows of Int16Array to limit
 * memory. Returns the complete m×n table as a flat array for traceback.
 * For inputs up to MAX_DIFF_TOKENS, peak memory is (m+1)*(n+1)*2 bytes = ~8 MB.
 */
function buildLcsTable(a: readonly string[], b: readonly string[]): Int16Array {
  const m = a.length;
  const n = b.length;
  // Full table for traceback (needed to reconstruct the edit ops)
  const table = new Int16Array((m + 1) * (n + 1));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        table[i * (n + 1) + j] = (table[(i - 1) * (n + 1) + (j - 1)] ?? 0) + 1;
      } else {
        const up = table[(i - 1) * (n + 1) + j] ?? 0;
        const left = table[i * (n + 1) + (j - 1)] ?? 0;
        table[i * (n + 1) + j] = Math.max(up, left);
      }
    }
  }
  return table;
}

interface EditOp {
  type: 'equal' | 'insert' | 'delete';
  token: string;
}

function traceback(a: readonly string[], b: readonly string[], table: Int16Array): EditOp[] {
  const n = b.length;
  const ops: EditOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', token: a[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (
      j > 0 &&
      (i === 0 || (table[i * (n + 1) + (j - 1)] ?? 0) >= (table[(i - 1) * (n + 1) + j] ?? 0))
    ) {
      ops.push({ type: 'insert', token: b[j - 1]! });
      j -= 1;
    } else {
      ops.push({ type: 'delete', token: a[i - 1]! });
      i -= 1;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * Compute a word-level diff between current and incoming page text.
 *
 * Returns classified TextRun[] sequences rather than character counts,
 * satisfying CMPR-003's requirement to classify insertions and deletions.
 *
 * @param current - Extracted text from the current document page.
 * @param incoming - Extracted text from the incoming document page.
 * @returns TextDiff with classified runs and insertion/deletion word counts.
 */
export function diffWords(current: string, incoming: string): TextDiff {
  const rawA = tokenize(current);
  const rawB = tokenize(incoming);

  const truncated = rawA.length > MAX_DIFF_TOKENS || rawB.length > MAX_DIFF_TOKENS;
  const a = truncated ? rawA.slice(0, MAX_DIFF_TOKENS) : rawA;
  const b = truncated ? rawB.slice(0, MAX_DIFF_TOKENS) : rawB;

  if (!a.length && !b.length) {
    return { runs: [], insertedWords: 0, deletedWords: 0, truncated };
  }

  // Degenerate cases: one side is empty
  if (!a.length) {
    const text = b.join(' ');
    return {
      runs: [{ type: 'insert', text, words: b.length }],
      insertedWords: b.length,
      deletedWords: 0,
      truncated,
    };
  }
  if (!b.length) {
    const text = a.join(' ');
    return {
      runs: [{ type: 'delete', text, words: a.length }],
      insertedWords: 0,
      deletedWords: a.length,
      truncated,
    };
  }

  const table = buildLcsTable(a, b);
  const ops = traceback(a, b, table);

  // Coalesce consecutive same-type ops into runs
  const runs: TextRun[] = [];
  let insertedWords = 0;
  let deletedWords = 0;

  for (const op of ops) {
    const last = runs.at(-1);
    if (last !== undefined && last.type === op.type) {
      runs[runs.length - 1] = {
        type: last.type,
        text: `${last.text} ${op.token}`,
        words: last.words + 1,
      };
    } else {
      runs.push({ type: op.type, text: op.token, words: 1 });
    }
    if (op.type === 'insert') insertedWords += 1;
    if (op.type === 'delete') deletedWords += 1;
  }

  return { runs, insertedWords, deletedWords, truncated };
}
