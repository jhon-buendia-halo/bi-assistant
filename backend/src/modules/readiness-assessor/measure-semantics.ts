// D4 Semantics, from the dataset's saved metadata: useful descriptions of the
// key columns, schema notes and layers, declared references, cryptic names.
import type { DatasetColumnSnapshot } from '../../mastra/tool-services';
import { belongsTo, grainKey, type InventoryEntity } from './inventory';
import { round, type MeasureContext } from './ledger';
import type { SemanticsMeasure } from './measures';

/**
 * A useful description says what the column represents (source 4.5):
 * "Monto" is not one. At least three words and fifteen characters, and not
 * the column's name spelled out.
 */
export function isUsefulDescription(column: DatasetColumnSnapshot): boolean {
  const text = column.description?.trim() ?? '';
  if (text.length < 15 || text.split(/\s+/).length < 3) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(text) !== norm(column.name);
}

/** `fld_07`, `x_amt2`, `c1`: names that say nothing without documentation. */
export function isCrypticName(name: string): boolean {
  if (name.toLowerCase() === 'id') return false;
  return name.length <= 2 || /^(?:[a-z]{1,4}_)?[a-z]{0,4}\d+$/i.test(name);
}

/** The key columns: critical fields and grain key; all columns when none is declared. */
export function keyColumns(
  ctx: MeasureContext,
  entity: InventoryEntity,
): string[] {
  const declared = [
    ...ctx.scope.criticalFields
      .filter((f) => belongsTo(entity, f.entity))
      .map((f) => f.column),
    ...(ctx.scope.grainKeys?.find((g) => belongsTo(entity, g.entity))
      ?.columns ?? []),
  ];
  const names = declared.length
    ? declared
    : grainKey(ctx.scope, entity).concat(entity.columns.map((c) => c.name));
  return [...new Set(names.map((n) => n.toLowerCase()))].map(
    (lower) =>
      entity.columns.find((c) => c.name.toLowerCase() === lower)?.name ?? lower,
  );
}

export function measureSemantics(
  ctx: MeasureContext,
  entity: InventoryEntity,
): SemanticsMeasure {
  const base = {
    entity: entity.key,
    columns: entity.columns.length,
    layer: entity.layer,
    schemaDescribed: !!entity.schemaDescription,
  };
  if (!entity.columnsKnown) {
    return {
      ...base,
      measured: false,
      described: 0,
      keyColumns: [],
      undocumentedKeys: [],
      cryptic: [],
    };
  }
  const useful = new Set(
    entity.columns.filter(isUsefulDescription).map((c) => c.name.toLowerCase()),
  );
  const keys = keyColumns(ctx, entity);
  const undocumentedKeys = keys.filter((k) => !useful.has(k.toLowerCase()));
  const cryptic = entity.columns.map((c) => c.name).filter(isCrypticName);
  const references = entity.columns.filter((c) => c.references).length;
  const evidenceId = ctx.ledger.addEvidence({
    dimension: 'D4',
    description: `Documentation of ${entity.key} in the dataset's saved metadata`,
    source: 'metadata',
    entity: entity.key,
    coverage: 'metadata',
    result: {
      columns: entity.columns.length,
      described_columns: useful.size,
      described_share: round(useful.size / entity.columns.length),
      key_columns: keys.length,
      described_key_share: keys.length
        ? round((keys.length - undocumentedKeys.length) / keys.length)
        : null,
      cryptic_names: cryptic.length,
      declared_references: references,
      schema_note: !!entity.schemaDescription,
      layer: entity.layer ?? null,
    },
  });
  return {
    ...base,
    measured: true,
    described: useful.size,
    keyColumns: keys,
    undocumentedKeys,
    cryptic,
    evidenceId,
  };
}
