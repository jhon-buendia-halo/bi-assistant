/**
 * A small line-level diff (LCS-based), good enough for comparing two data
 * model YAML versions side by side (`features/data-model/components/model-versions`)
 * without pulling in a diff library. Not a general-purpose text diff: it
 * operates on whole lines, which is exactly the grain a YAML version
 * comparison needs (the DSL's one-key-per-line serialization in
 * `dsl/yaml.ts` means a changed field is a changed line).
 */

export type DiffLineKind = 'unchanged' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the side this line came from (`before` for
   * `removed`/`unchanged`, `after` for `added`/`unchanged`); undefined when
   * the line does not exist on that side. */
  beforeLine?: number;
  afterLine?: number;
}

/**
 * Longest-common-subsequence line diff. `O(n*m)` time/space over line
 * counts — model YAML files are at most a few hundred lines, so the
 * quadratic table is simpler and fast enough rather than a linear-space
 * variant.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  // An empty string is zero lines, not one empty line — otherwise comparing
  // against an empty document would diff a phantom blank line instead of
  // reporting a pure insertion/deletion.
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({
        kind: 'unchanged',
        text: a[i],
        beforeLine: i + 1,
        afterLine: j + 1,
      });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: 'removed', text: a[i], beforeLine: i + 1 });
      i += 1;
    } else {
      result.push({ kind: 'added', text: b[j], afterLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ kind: 'removed', text: a[i], beforeLine: i + 1 });
    i += 1;
  }
  while (j < m) {
    result.push({ kind: 'added', text: b[j], afterLine: j + 1 });
    j += 1;
  }
  return result;
}
