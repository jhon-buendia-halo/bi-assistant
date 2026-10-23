/**
 * Deterministic helpers shared by the fixture generators.
 *
 * Every generator seeds one `Rng` and draws every random value from it, so the
 * same seed always produces byte-identical SQL. That is what makes a
 * hand-verified `expectedSql` stay valid across regenerations — the moment a
 * generator reaches for `Math.random()`, every checked answer in the eval set
 * silently becomes a guess.
 */

/** mulberry32 — small, fast, and stable across Node versions. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max), rounded to `decimals`. */
  float(min: number, max: number, decimals = 2): number {
    const value = min + this.next() * (max - min);
    return Number(value.toFixed(decimals));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element, uniformly. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() needs a non-empty array');
    return items[this.int(0, items.length - 1)];
  }

  /**
   * One element, by relative weight. Weights need not sum to 1.
   * Used wherever a planted distribution matters — a 95%-null column, a
   * status mix — because `pick` alone cannot express it.
   */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of items) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return items[items.length - 1][0];
  }

  /** A Fisher-Yates shuffle of a copy, drawing from this generator. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** An ISO date (no time) `days` after `start`. */
  dateAfter(start: string, days: number): string {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /** A uniform ISO date in [from, to], inclusive, both `YYYY-MM-DD`. */
  dateBetween(from: string, to: string): string {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const span = Math.round((end - start) / 86_400_000);
    return this.dateAfter(from, this.int(0, span));
  }
}

/* ------------------------------------------------------------------ SQL */

/** A SQL string literal with embedded quotes doubled. */
export function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** A SQL literal for any scalar a generator produces. NULL for null/undefined. */
export function literal(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return sql(value);
}

/**
 * A multi-row INSERT, chunked so no single statement grows unreadable.
 * Column lists are written out rather than relying on table order, so adding a
 * column to the DDL cannot silently shift every value one place to the left.
 */
export function insertRows(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
  chunkSize = 200,
): string {
  if (rows.length === 0) return '';
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = chunk
      .map((row) => {
        if (row.length !== columns.length) {
          throw new Error(
            `${table}: row has ${row.length} values for ${columns.length} columns`,
          );
        }
        return `  (${row.map(literal).join(', ')})`;
      })
      .join(',\n');
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`,
    );
  }
  return statements.join('\n\n');
}

/** A banner comment, so the generated SQL is navigable by eye. */
export function section(title: string): string {
  const rule = '-'.repeat(Math.max(0, 70 - title.length));
  return `-- ${title} ${rule}`;
}
