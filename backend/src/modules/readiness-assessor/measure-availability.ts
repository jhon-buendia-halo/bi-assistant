// D1 Availability: the entity resolves, answers COUNT(*), its row count and
// date range; the owner comes from the scoping card (no owner metadata).
import type { InventoryEntity } from './inventory';
import { attempt, field, toNum, type MeasureContext } from './ledger';
import type { AvailabilityMeasure } from './measures';
import { countRowsSql } from './sql';

export function ownerOf(
  ctx: MeasureContext,
  dataset: string,
): string | undefined {
  const lower = dataset.toLowerCase();
  return ctx.scope.owners
    ?.find((o) => o.dataset.toLowerCase() === lower && o.owner.trim())
    ?.owner.trim();
}

export async function measureAvailability(
  ctx: MeasureContext,
  entity: InventoryEntity,
): Promise<AvailabilityMeasure> {
  const base = {
    entity: entity.key,
    dataset: entity.dataset,
    found: entity.found,
    manualAccess: entity.kind === 'file',
    owner: ownerOf(ctx, entity.dataset),
  };
  if (!entity.found || !entity.datasourceId) {
    const reason = entity.found
      ? 'its dataset has no datasource'
      : 'no dataset of the session holds it';
    const id = ctx.ledger.addEvidence({
      dimension: 'D1',
      description: `Whether ${entity.key} exists in the session's datasets`,
      source: 'metadata',
      entity: entity.key,
      coverage: 'metadata',
      result: { found: entity.found, accessible: false },
    });
    return { ...base, accessible: false, reason, evidenceIds: [id] };
  }
  const sql = countRowsSql(entity);
  const datasourceId = entity.datasourceId;
  const run = await attempt(ctx, () =>
    ctx.port.runSql(datasourceId, sql, ctx.signal),
  );
  const rowCount = run.ok
    ? toNum(field(run.value.rows[0] ?? {}, 'row_count'))
    : null;
  const accessible = run.ok && rowCount !== null;
  const range = rangeOf(entity);
  const id = ctx.ledger.addEvidence({
    dimension: 'D1',
    description: `Programmatic access to ${entity.key} (row count)`,
    source: 'sql',
    sql,
    datasourceId,
    entity: entity.key,
    coverage: 'whole-table',
    result: accessible
      ? {
          accessible: true,
          row_count: rowCount,
          ...(range ? { date_min: range.min, date_max: range.max } : {}),
        }
      : {
          accessible: false,
          error: run.ok ? 'no row count returned' : run.reason,
        },
  });
  return {
    ...base,
    accessible,
    rowCount: rowCount ?? undefined,
    reason: accessible
      ? undefined
      : run.ok
        ? 'no row count returned'
        : run.reason,
    evidenceIds: [id],
  };
}

/** The widest saved date range of the entity's columns (metadata). */
function rangeOf(entity: InventoryEntity): { min: string; max: string } | null {
  const ranges = entity.columns.flatMap((c) => (c.range ? [c.range] : []));
  if (!ranges.length) return null;
  return {
    min: ranges.map((r) => r.min).sort()[0],
    max: ranges
      .map((r) => r.max)
      .sort()
      .reverse()[0],
  };
}
