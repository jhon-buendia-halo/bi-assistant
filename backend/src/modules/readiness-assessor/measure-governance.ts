// D5 Governance: a PII scan over the entity's sample (email, phone, card
// number, national id; types and match rates only) and column-name hints.
import type { InventoryEntity } from './inventory';
import { round, type MeasureContext } from './ledger';
import type { Sample } from './measure-quality';
import type { GovernanceMeasure } from './measures';
import {
  nameOnlyPiiHint,
  presentValues,
  scanPii,
  type PiiColumn,
} from './sample-checks';

export function measureGovernance(
  ctx: MeasureContext,
  entity: InventoryEntity,
  sample: Sample,
): GovernanceMeasure {
  const base = { entity: entity.key, pii: [], nameHints: [], evidenceIds: [] };
  if (!sample.ok) {
    return { ...base, scanned: false, sampleSize: 0, reason: sample.reason };
  }
  const { rows } = sample.value;
  const columns = sample.value.columns.length
    ? sample.value.columns
    : entity.columns.map((c) => c.name);
  const pii: PiiColumn[] = [];
  const nameHints: string[] = [];
  for (const column of columns) {
    const hit = scanPii(column, presentValues(rows, column));
    if (hit) pii.push(hit);
    else if (nameOnlyPiiHint(column)) nameHints.push(column);
  }
  const result: Record<string, number | string> = {
    sample_size: rows.length,
    columns_scanned: columns.length,
    pii_columns: pii.length,
  };
  for (const p of pii) {
    result[`pii_type:${p.column}`] = p.type;
    result[`pii_match_rate:${p.column}`] = round(p.matchRate);
  }
  if (nameHints.length) result.name_hint_columns = nameHints.join(', ');
  const id = ctx.ledger.addEvidence({
    dimension: 'D5',
    description: `PII scan of ${entity.key}: detected types and match rates over a sample (never values)`,
    source: 'sample',
    datasourceId: entity.datasourceId,
    entity: entity.key,
    coverage: 'sample',
    sampleSize: rows.length,
    result,
  });
  return {
    ...base,
    scanned: true,
    sampleSize: rows.length,
    pii,
    nameHints,
    evidenceIds: [id],
  };
}
