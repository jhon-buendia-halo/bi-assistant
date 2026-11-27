// D6 AI fitness for an agent over structured data (`rag-agent`): machine-
// readable descriptions, coded values without a dictionary, raw (`landing`)
// layer exposure and PII exposure. `ml` fitness is not measurable (N/E).
import type { InventoryEntity } from './inventory';
import { round, type MeasureContext } from './ledger';
import { isUsefulDescription } from './measure-semantics';
import type { Sample } from './measure-quality';
import type { AiFitnessMeasure, GovernanceMeasure } from './measures';
import { looksCoded, presentValues } from './sample-checks';

export function measureAiFitness(
  ctx: MeasureContext,
  entity: InventoryEntity,
  sample: Sample,
  governance: GovernanceMeasure,
): AiFitnessMeasure {
  const base = {
    entity: entity.key,
    layer: entity.layer,
    piiColumns: governance.pii.length,
  };
  if (!entity.columnsKnown) {
    return {
      ...base,
      measured: false,
      describedShare: 0,
      codedUndocumented: [],
      evidenceIds: [],
    };
  }
  const described = entity.columns.filter(isUsefulDescription);
  const describedShare = described.length / entity.columns.length;
  const codedUndocumented =
    sample.ok && sample.value.rows.length
      ? entity.columns
          .filter((c) => !isUsefulDescription(c))
          .filter((c) => looksCoded(presentValues(sample.value.rows, c.name)))
          .map((c) => c.name)
      : [];
  const id = ctx.ledger.addEvidence({
    dimension: 'D6',
    description: `What an agent querying ${entity.key} can read: descriptions, codes, layer and exposed PII`,
    source: sample.ok ? 'sample' : 'metadata',
    datasourceId: entity.datasourceId,
    entity: entity.key,
    coverage: sample.ok ? 'sample' : 'metadata',
    ...(sample.ok ? { sampleSize: sample.value.rows.length } : {}),
    result: {
      described_share: round(describedShare),
      coded_columns_without_dictionary: codedUndocumented.length,
      coded_checked: sample.ok,
      layer: entity.layer ?? null,
      exposed_pii_columns: governance.scanned ? governance.pii.length : null,
    },
  });
  return {
    ...base,
    measured: true,
    describedShare,
    codedUndocumented,
    evidenceIds: [id, ...governance.evidenceIds],
  };
}
