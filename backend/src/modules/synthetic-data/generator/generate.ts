// The generator (plan 2.4). Pure, synchronous, deterministic.
//
// 1. Key phase, for every table before any table is emitted: the PK and unique-key
//    columns, and every column another table references, are generated first, so every
//    foreign-key value is drawn from a key set that already exists (cycles are harmless).
//    A key made only of foreign-key columns draws distinct parent tuples; when the
//    tuples run out the table holds fewer rows (plan.ts clamps the usual cases upfront).
// 2. Tables are emitted in topological order (order.ts). Each table's remaining columns
//    are generated lazily, the first time its `rows` is read, so a caller can read every
//    table's columns before generating any rows (script.ts does).
//
// Every column (and every FK relationship, and every key group) has its own PRNG stream
// seeded by (seed, table key, column names): adding a table or a column never changes
// another column's values.

import type { SyntheticValue } from '../dialects/writer';
import type { SampledColumn, SampledProfile, SampledTable } from '../types';
import type { GeneratedTable, GenerationPlan } from './contract';
import { declaredMaxLength } from './format';
import {
  analyseTable,
  type FkUnit,
  type TableKeyPlan,
  type TupleGroup,
} from './keys';
import { emissionOrder } from './order';
import { Prng, shuffledIndices } from './prng';
import { valueSource } from './values';

const EXACT_SPACE_MAX = 2 ** 52;
/** Random attempts per wanted row when the tuple space is too large to shuffle. */
const ATTEMPTS_PER_ROW = 20;

type Tuple = SyntheticValue[];

export function valueKey(v: SyntheticValue): string {
  if (v === null) return '\u0001null';
  if (typeof v === 'boolean') return v ? '\u0001true' : '\u0001false';
  if (typeof v === 'string') return `s:${v}`;
  return 'text' in v ? `${v.kind}:${v.text}` : `\u0001${v.kind}`;
}

interface TableState {
  table: SampledTable;
  planned: number;
  clampedFrom?: number;
  targetName: string;
  keys: TableKeyPlan;
  /** Columns generated in the key phase. */
  early: Set<string>;
  status: 'pending' | 'running' | 'done';
  rows: number;
  values: Map<string, SyntheticValue[]>;
  /** Units drawn in the key phase. */
  drawnUnits: Set<number>;
}

export function* generateTables(
  profile: SampledProfile,
  plan: GenerationPlan,
): Generator<GeneratedTable> {
  const gen = new TableGenerator(profile, plan);
  const order = emissionOrder(
    plan.tables.map((t) => t.key),
    plan.relationships,
  );
  for (const key of order) gen.ensureKeys(key);
  for (const key of order) yield gen.table(key);
}

class TableGenerator {
  private readonly states = new Map<string, TableState>();
  private readonly tupleCache = new Map<string, Tuple[] | undefined>();

  constructor(
    private readonly profile: SampledProfile,
    private readonly plan: GenerationPlan,
  ) {
    const referenced = new Map<string, Set<string>>();
    for (const r of plan.relationships) {
      const set = referenced.get(r.toTable) ?? new Set<string>();
      r.toColumns.forEach((c) => set.add(c));
      referenced.set(r.toTable, set);
    }
    const byKey = new Map(profile.tables.map((t) => [t.key, t]));
    for (const p of plan.tables) {
      const table = byKey.get(p.key);
      if (!table) continue;
      const keys = analyseTable(table, plan.relationships);
      const early = new Set([
        ...keys.keyColumns,
        ...(referenced.get(p.key) ?? []),
      ]);
      for (const g of keys.groups) {
        for (const u of g.units)
          keys.units[u].rel.fromColumns.forEach((c) => early.add(c));
      }
      this.states.set(p.key, {
        table,
        planned: p.rows,
        clampedFrom: p.clampedFrom,
        targetName: p.targetName,
        keys,
        early,
        status: 'pending',
        rows: p.rows,
        values: new Map(),
        drawnUnits: new Set(),
      });
    }
  }

  private prng(tableKey: string, ...parts: string[]): Prng {
    return new Prng(this.plan.seed, tableKey, ...parts);
  }

  /** Key phase of one table (and, first, of the parents its key columns draw from). */
  ensureKeys(key: string): void {
    const s = this.states.get(key);
    if (!s || s.status !== 'pending') return;
    s.status = 'running';

    // Groups: distinct parent tuples; they fix the row count.
    const picks = new Map<number, number[]>();
    let rows = s.planned;
    const drawnGroups: {
      group: TupleGroup;
      tuples: Tuple[][];
      picks: number[][];
    }[] = [];
    for (const group of s.keys.groups) {
      const tuples = group.units.map((u) => this.parentTuples(s.keys.units[u]));
      if (tuples.some((t) => t === undefined)) continue; // key cycle: columns fall back
      const drawn = this.drawGroup(s, group, tuples as Tuple[][], rows);
      rows = Math.min(rows, drawn[0]?.length ?? rows);
      drawnGroups.push({ group, tuples: tuples as Tuple[][], picks: drawn });
    }
    s.rows = rows;
    for (const d of drawnGroups) {
      d.group.units.forEach((u, i) => {
        picks.set(u, d.picks[i].slice(0, rows));
        this.writeUnit(s, u, d.tuples[i], picks.get(u)!);
      });
    }

    // Other early FK columns: uniform draws from the parent, no NULLs.
    for (const col of s.table.columns) {
      if (!s.early.has(col.name) || s.values.has(col.name)) continue;
      const u = s.keys.fkColumn.get(col.name);
      if (u !== undefined && !s.drawnUnits.has(u)) {
        const tuples = this.parentTuples(s.keys.units[u]);
        if (tuples) {
          this.writeUnit(s, u, tuples, this.uniformPicks(s, u, tuples, false));
          continue;
        }
      }
      if (!s.values.has(col.name))
        s.values.set(col.name, this.plainColumn(s, col, false));
    }
    s.status = 'done';
  }

  /** Distinct non-null tuples of a parent's referenced columns; undefined in a key cycle. */
  private parentTuples(unit: FkUnit): Tuple[] | undefined {
    const id = `${unit.rel.toTable}\u0000${unit.rel.toColumns.join('\u0000')}`;
    if (this.tupleCache.has(id)) return this.tupleCache.get(id);
    this.ensureKeys(unit.rel.toTable);
    const p = this.states.get(unit.rel.toTable);
    if (!p || p.status !== 'done') return undefined;
    const cols = unit.rel.toColumns.map((c) => p.values.get(c));
    if (cols.some((c) => c === undefined)) return undefined;
    const seen = new Set<string>();
    const out: Tuple[] = [];
    for (let i = 0; i < p.rows; i++) {
      const t = cols.map((c) => c![i]);
      if (t.some((v) => v === null)) continue;
      const k = t.map(valueKey).join('\u0003');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    this.tupleCache.set(id, out);
    return out;
  }

  /** Picks (tuple indices per unit, per row) keeping every constraint of the group distinct. */
  private drawGroup(
    s: TableState,
    group: TupleGroup,
    tuples: Tuple[][],
    want: number,
  ): number[][] {
    const prng = this.prng(
      s.table.key,
      '\u0002key',
      ...group.units.map((u) => s.keys.units[u].rel.fromColumns.join(',')),
    );
    const picks: number[][] = group.units.map(() => []);
    const sizes = tuples.map((t) => t.length);
    const space = sizes.reduce((a, b) => a * b, 1);
    if (space === 0 || want === 0) return picks;
    const seen = group.constraints.map(() => new Set<string>());
    const where = (col: string): [number, number] => {
      const u = s.keys.fkColumn.get(col)!;
      return [
        group.units.indexOf(u),
        s.keys.units[u].rel.fromColumns.indexOf(col),
      ];
    };
    const constraintCols = group.constraints.map((cols) =>
      cols
        .filter(
          (c) =>
            s.keys.fkColumn.has(c) &&
            group.units.includes(s.keys.fkColumn.get(c)!),
        )
        .map(where),
    );
    const accept = (idx: number[]): boolean => {
      const ks = constraintCols.map((cs) =>
        cs
          .map(([ui, pos]) => valueKey(tuples[ui][idx[ui]][pos]))
          .join('\u0003'),
      );
      if (ks.some((k, i) => seen[i].has(k))) return false;
      ks.forEach((k, i) => seen[i].add(k));
      idx.forEach((v, i) => picks[i].push(v));
      return true;
    };
    if (space <= EXACT_SPACE_MAX) {
      for (const flat of shuffledIndices(prng, space)) {
        let rest = flat;
        const idx = sizes.map((n) => {
          const v = rest % n;
          rest = Math.floor(rest / n);
          return v;
        });
        accept(idx);
        if (picks[0].length >= want) break;
      }
    } else {
      for (
        let a = 0;
        a < want * ATTEMPTS_PER_ROW && picks[0].length < want;
        a++
      ) {
        accept(sizes.map((n) => prng.int(n)));
      }
    }
    return picks;
  }

  private uniformPicks(
    s: TableState,
    u: number,
    tuples: Tuple[],
    nulls: boolean,
  ): number[] {
    const unit = s.keys.units[u];
    const prng = this.prng(s.table.key, unit.rel.fromColumns.join('\u0001'));
    const cols = unit.rel.fromColumns.map((c) =>
      s.table.columns.find((x) => x.name === c)!,
    );
    const nullable =
      nulls && cols.every((c) => c.nullable && !s.keys.keyColumns.has(c.name));
    const nullFraction = nullable ? cols[0].nullFraction : 0;
    const out: number[] = [];
    for (let i = 0; i < s.rows; i++) {
      if (tuples.length === 0 || prng.chance(nullFraction)) out.push(-1);
      else out.push(prng.int(tuples.length));
    }
    return out;
  }

  /** Write a unit's columns from tuple picks (-1 = NULL). */
  private writeUnit(
    s: TableState,
    u: number,
    tuples: Tuple[],
    picks: number[],
  ): void {
    s.drawnUnits.add(u);
    s.keys.units[u].rel.fromColumns.forEach((c, pos) => {
      s.values.set(
        c,
        picks.map((i) => (i < 0 ? null : tuples[i][pos])),
      );
    });
  }

  private plainColumn(
    s: TableState,
    col: SampledColumn,
    nulls: boolean,
  ): SyntheticValue[] {
    const prng = this.prng(s.table.key, col.name);
    const source = valueSource({
      column: col,
      dialect: this.profile.dialect,
      rows: s.rows,
      prng,
      maxLength: declaredMaxLength(col.type),
    });
    const nullable =
      nulls &&
      col.nullable &&
      !s.keys.keyColumns.has(col.name) &&
      col.strategy !== 'null-only' &&
      col.strategy !== 'constant' &&
      col.nullFraction > 0;
    const out: SyntheticValue[] = [];
    for (let i = 0; i < s.rows; i++) {
      out.push(nullable && prng.chance(col.nullFraction) ? null : source(i));
    }
    return out;
  }

  private buildRows(s: TableState): SyntheticValue[][] {
    const unitPicks = new Map<number, number[]>();
    const columns: SyntheticValue[][] = s.table.columns.map((col) => {
      const early = s.values.get(col.name);
      if (early) return early;
      const u = s.keys.fkColumn.get(col.name);
      if (u !== undefined) {
        const tuples = this.parentTuples(s.keys.units[u]);
        if (tuples) {
          let picks = unitPicks.get(u);
          if (!picks)
            unitPicks.set(u, (picks = this.uniformPicks(s, u, tuples, true)));
          const pos = s.keys.units[u].rel.fromColumns.indexOf(col.name);
          return picks.map((i) => (i < 0 ? null : tuples[i][pos]));
        }
      }
      return this.plainColumn(s, col, true);
    });
    const rows: SyntheticValue[][] = [];
    for (let i = 0; i < s.rows; i++) rows.push(columns.map((c) => c[i]));
    return rows;
  }

  table(key: string): GeneratedTable {
    const s = this.states.get(key)!;
    const requested = s.clampedFrom ?? s.planned;
    const out = {
      key,
      targetName: s.targetName,
      columns: s.table.columns,
      primaryKey: s.table.primaryKey,
      uniqueKeys: s.table.uniqueKeys,
      ...(s.rows < requested ? { clampedFrom: requested } : {}),
    } as GeneratedTable;
    let memo: SyntheticValue[][] | undefined;
    Object.defineProperty(out, 'rows', {
      enumerable: true,
      get: () => (memo ??= this.buildRows(s)),
    });
    return out;
  }
}
