/**
 * The figures an answer may derive from result rows (roadmap 1.28.8): the
 * writer's rules allow "averages, ratios and other derived figures", so a
 * check that a figure "comes from the rows" accepts, besides each cell, the
 * sum of each numeric column, the difference of two values and a share of
 * one value in another (as a percent and as a ratio). Kept small: at most
 * 60 base values enter the pairs.
 */
export function derivedFigures(
  rows: readonly Record<string, unknown>[],
  extra: readonly number[] = [],
): number[] {
  const cells: number[] = [];
  const sums = new Map<string, number>();
  for (const row of rows) {
    for (const [column, cell] of Object.entries(row ?? {})) {
      const value =
        typeof cell === 'number'
          ? cell
          : typeof cell === 'string' && /^-?\d+(?:\.\d+)?$/.test(cell.trim())
            ? Number(cell)
            : NaN;
      if (!Number.isFinite(value)) continue;
      cells.push(value);
      sums.set(column, (sums.get(column) ?? 0) + value);
    }
  }
  const base = [...new Set([...cells, ...sums.values(), ...extra])].slice(
    0,
    60,
  );
  const out = new Set(base);
  const pairSums: number[] = [];
  for (const a of base) {
    for (const b of base) {
      if (a === b) continue;
      out.add(Math.abs(a - b));
      pairSums.push(a + b);
      if (b !== 0) {
        out.add((a / b) * 100);
        out.add(a / b);
      }
    }
  }
  // A total less two parts ("5,000 products, 4,994 with a finite weight").
  for (const a of base) {
    for (const s of pairSums) out.add(Math.abs(a - s));
  }
  return [...out];
}

/** Whether `value`, written with `decimals` decimals, is one of `known` rounded so. */
export function matchesRounded(
  value: number,
  decimals: number,
  known: readonly number[],
): boolean {
  const factor = 10 ** decimals;
  return known.some((k) => Math.round(k * factor) / factor === value);
}
