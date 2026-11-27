// D2 Quality: null/blank rates of the critical fields and duplicate grain
// keys (SQL), invalid formats and sentinels (sample), orphan references (SQL).
import {
  belongsTo,
  findColumn,
  grainKey,
  semanticType,
  type InventoryEntity,
} from './inventory';
import {
  attempt,
  field,
  round,
  toNum,
  type Attempt,
  type MeasureContext,
} from './ledger';
import type { FieldQuality, QualityMeasure } from './measures';
import {
  DEFAULT_MAX_DUPLICATE_RATE,
  DEFAULT_MAX_NULL_RATE,
  MAX_INVALID_FORMAT_RATE,
  MAX_ORPHAN_RATE,
  SAMPLE_SIZE,
} from './rubric';
import {
  formatRuleFor,
  invalidFormat,
  presentValues,
  sentinels,
} from './sample-checks';
import { grainCountSql, nullCountsSql, orphansSql } from './sql';

export type Sample = Attempt<{
  columns: string[];
  rows: Record<string, unknown>[];
}>;
type Window = { column: string; since: Date } | undefined;

/** One sample per entity, sized by risk, shared by D2, D5 and D6. */
export async function takeSample(
  ctx: MeasureContext,
  entity: InventoryEntity,
): Promise<Sample> {
  const datasourceId = entity.datasourceId;
  if (!datasourceId) return { ok: false, reason: 'no datasource' };
  return attempt(ctx, () =>
    ctx.port.sampleRows(
      datasourceId,
      entity.datasetKey,
      SAMPLE_SIZE[ctx.scope.risk],
      ctx.signal,
    ),
  );
}

export async function measureQuality(
  ctx: MeasureContext,
  entity: InventoryEntity,
  sample: Sample,
  window: Window,
): Promise<QualityMeasure> {
  const m: QualityMeasure = {
    entity: entity.key,
    measured: false,
    fields: [],
    validity: [],
    orphans: [],
    notes: [],
    window: window
      ? `rows since ${window.since.toISOString().slice(0, 10)} by \`${window.column}\` (large table)`
      : undefined,
  };
  const declared = ctx.scope.criticalFields.filter((f) =>
    belongsTo(entity, f.entity),
  );
  m.fields = declared.map((f): FieldQuality => ({
    column: findColumn(entity, f.column)?.name ?? f.column,
    indispensable: f.indispensable,
    missing: entity.columnsKnown && !findColumn(entity, f.column),
    evidenceIds: [],
  }));
  const thresholds = new Map(
    declared.map((f) => [
      f.column.toLowerCase(),
      f.maxNullRate ?? DEFAULT_MAX_NULL_RATE,
    ]),
  );
  const nullThreshold = (c: string) =>
    thresholds.get(c.toLowerCase()) ?? DEFAULT_MAX_NULL_RATE;
  for (const f of m.fields.filter((x) => x.missing)) {
    f.evidenceIds.push(
      ctx.ledger.addEvidence({
        dimension: 'D2',
        description: `Critical field \`${f.column}\` in the metadata of ${entity.key}`,
        source: 'metadata',
        entity: entity.key,
        coverage: 'metadata',
        result: { column: f.column, present: false },
      }),
    );
  }
  await nullRates(ctx, entity, m, nullThreshold, window);
  await duplicates(ctx, entity, m, window);
  sampleValidity(ctx, entity, m, sample, nullThreshold);
  await orphans(ctx, entity, m, window);
  m.measured =
    m.fields.some((f) => f.missing || f.nulls || f.format || f.sentinels) ||
    !!m.duplicates ||
    m.validity.length > 0 ||
    m.orphans.length > 0;
  return m;
}

async function nullRates(
  ctx: MeasureContext,
  entity: InventoryEntity,
  m: QualityMeasure,
  threshold: (c: string) => number,
  window: Window,
): Promise<void> {
  const fields = m.fields.filter((f) => !f.missing);
  if (!fields.length) {
    if (!m.fields.length) m.notes.push('no critical field was declared for it');
    return;
  }
  const cols = fields.map((f) => {
    const col = findColumn(entity, f.column);
    return {
      name: f.column,
      text: !!col && semanticType(col, entity.kind) === 'text',
    };
  });
  const sql = nullCountsSql(entity, cols, window);
  const run = await attempt(ctx, () =>
    ctx.port.runSql(entity.datasourceId!, sql, ctx.signal),
  );
  if (!run.ok) {
    for (const f of fields) f.notEvaluated = run.reason;
    return;
  }
  const row = run.value.rows[0] ?? {};
  const rows = toNum(field(row, 'row_count')) ?? 0;
  if (rows === 0) {
    for (const f of fields) f.notEvaluated = 'the table has no rows';
    return;
  }
  const result: Record<string, number> = { row_count: rows };
  const rates = cols.map((c, i) => {
    const nonNull = toNum(field(row, `nn_${i}`)) ?? 0;
    const blank = c.text ? (toNum(field(row, `blank_${i}`)) ?? 0) : 0;
    const rate = (rows - nonNull + blank) / rows;
    result[`null_rate:${c.name}`] = round(rate);
    return rate;
  });
  const id = ctx.ledger.addEvidence({
    dimension: 'D2',
    description: `Null or blank share of the critical fields of ${entity.key}${m.window ? `, ${m.window}` : ''}`,
    source: 'sql',
    sql,
    datasourceId: entity.datasourceId,
    entity: entity.key,
    coverage: m.window ? 'sample' : 'whole-table',
    result,
  });
  fields.forEach((f, i) => {
    f.nulls = {
      rate: rates[i],
      threshold: threshold(f.column),
      evidenceId: id,
    };
    f.evidenceIds.push(id);
  });
}

async function duplicates(
  ctx: MeasureContext,
  entity: InventoryEntity,
  m: QualityMeasure,
  window: Window,
): Promise<void> {
  const columns = grainKey(ctx.scope, entity);
  if (!columns.length) {
    m.notes.push('no grain key was declared and it has no `id` column');
    return;
  }
  const sql = grainCountSql(entity, columns, window);
  const run = await attempt(ctx, () =>
    ctx.port.runSql(entity.datasourceId!, sql, ctx.signal),
  );
  if (!run.ok) {
    m.notes.push(`duplicates not measured: ${run.reason}`);
    return;
  }
  const row = run.value.rows[0] ?? {};
  const rows = toNum(field(row, 'row_count')) ?? 0;
  const keys = toNum(field(row, 'key_count')) ?? 0;
  const dup = Math.max(0, rows - keys);
  const rate = rows ? dup / rows : 0;
  const id = ctx.ledger.addEvidence({
    dimension: 'D2',
    description: `Duplicate grain keys (${columns.join(', ')}) in ${entity.key}`,
    source: 'sql',
    sql,
    datasourceId: entity.datasourceId,
    entity: entity.key,
    coverage: m.window ? 'sample' : 'whole-table',
    result: {
      row_count: rows,
      distinct_keys: keys,
      duplicate_rate: round(rate),
    },
  });
  m.duplicates = {
    columns,
    duplicates: dup,
    rate,
    threshold: ctx.scope.maxDuplicateRate ?? DEFAULT_MAX_DUPLICATE_RATE,
    evidenceId: id,
  };
}

function sampleValidity(
  ctx: MeasureContext,
  entity: InventoryEntity,
  m: QualityMeasure,
  sample: Sample,
  nullThreshold: (c: string) => number,
): void {
  if (!sample.ok) {
    m.notes.push(`formats and sentinels not measured: ${sample.reason}`);
    return;
  }
  const rows = sample.value.rows;
  if (!rows.length) return;
  const critical = new Set(m.fields.map((f) => f.column.toLowerCase()));
  const targets = [
    ...m.fields.filter((f) => !f.missing).map((f) => f.column),
    ...grainKey(ctx.scope, entity).filter(
      (c) => !critical.has(c.toLowerCase()),
    ),
  ];
  const result: Record<string, number> = { sample_size: rows.length };
  const pending: (() => void)[] = [];
  let evidenceId = '';
  for (const column of targets) {
    const values = presentValues(rows, column);
    if (!values.length) continue;
    const rule = formatRuleFor(column);
    const fmt = rule ? invalidFormat(values, rule) : undefined;
    const sen = sentinels(values);
    const fq = m.fields.find((f) => f.column === column);
    if (fmt && fmt.checked) {
      result[`invalid_format_rate:${column}`] = round(fmt.rate);
      const measure = { rate: fmt.rate, threshold: MAX_INVALID_FORMAT_RATE };
      pending.push(() => {
        if (fq) {
          fq.format = { ...measure, rule: rule!, evidenceId };
          fq.evidenceIds.push(evidenceId);
        } else {
          m.validity.push({ ...measure, column, check: 'format', evidenceId });
        }
      });
    }
    result[`sentinel_rate:${column}`] = round(sen.rate);
    const sm = { rate: sen.rate, threshold: nullThreshold(column) };
    pending.push(() => {
      if (fq) {
        fq.sentinels = { ...sm, evidenceId };
        fq.evidenceIds.push(evidenceId);
      } else {
        m.validity.push({ ...sm, column, check: 'sentinel', evidenceId });
      }
    });
  }
  if (!pending.length) return;
  evidenceId = ctx.ledger.addEvidence({
    dimension: 'D2',
    description: `Invalid formats and sentinel values (-1, 'N/A', 'test', 1900-01-01, 9999-12-31) in the key columns of ${entity.key}`,
    source: 'sample',
    datasourceId: entity.datasourceId,
    entity: entity.key,
    coverage: 'sample',
    sampleSize: rows.length,
    result,
  });
  for (const apply of pending) apply();
}

async function orphans(
  ctx: MeasureContext,
  entity: InventoryEntity,
  m: QualityMeasure,
  window: Window,
): Promise<void> {
  const refs = entity.columns.filter((c) => c.references).slice(0, 10);
  for (const col of refs) {
    const ref = col.references!;
    const parent = { kind: entity.kind, datasetKey: ref.entity };
    const sql = orphansSql(entity, col.name, parent, ref.column, window);
    const run = await attempt(ctx, () =>
      ctx.port.runSql(entity.datasourceId!, sql, ctx.signal),
    );
    if (!run.ok) {
      m.notes.push(`orphans of \`${col.name}\` not measured: ${run.reason}`);
      continue;
    }
    const row = run.value.rows[0] ?? {};
    const checked = toNum(field(row, 'checked')) ?? 0;
    const count = toNum(field(row, 'orphans')) ?? 0;
    const rate = checked ? count / checked : 0;
    const target = `${ref.entity}.${ref.column}`;
    const id = ctx.ledger.addEvidence({
      dimension: 'D2',
      description: `References from \`${col.name}\` of ${entity.key} with no row in ${target} (${ref.source})`,
      source: 'sql',
      sql,
      datasourceId: entity.datasourceId,
      entity: entity.key,
      coverage: m.window ? 'sample' : 'whole-table',
      result: { checked, orphans: count, orphan_rate: round(rate) },
    });
    m.orphans.push({
      column: col.name,
      target,
      orphans: count,
      rate,
      threshold: MAX_ORPHAN_RATE,
      declared: ref.source === 'declared',
      evidenceId: id,
    });
  }
}
