/**
 * Snapshot-drift detection (ADR-0006: "later snapshots produce a drift
 * report, never an overwrite"). Pure, like `bootstrap.ts` — compares a
 * model version's `sql`-bound entities against a fresh physical snapshot and
 * reports what changed, without touching storage or picking a version.
 */
import type { DataModel } from './entities/data-model.entity';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import {
  bindingAddress,
  deriveEntityNames,
  inferAttributeType,
  lastSegment,
  safeName,
} from './bootstrap';

export interface DriftChange {
  ref: string;
  from: string;
  to: string;
}

export interface DriftReport {
  checkedAt: string;
  /** The model version this report was computed against. */
  snapshotOf: number;
  /** `<entity>.<attribute>` refs for new, unbound physical columns. */
  added: string[];
  /** `<entity>.<attribute>` refs for attributes with no matching column left. */
  removed: string[];
  changed: DriftChange[];
  /** Logical names (as bootstrap would produce them) for unbound tables. */
  entitiesAdded: string[];
  /** Bound entities whose table disappeared from the snapshot entirely. */
  entitiesRemoved: string[];
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * Compares `model`'s `sql`- and `rest`-bound entities against `dataset`'s
 * current snapshot (review finding 5 — `rest` bindings used to be skipped
 * entirely here, which made every REST-datasource entity look "added" on
 * every drift check since none of them were ever recognised as bound).
 */
export function driftReport(
  model: DataModel,
  dataset: DatasetDoc,
  now: string,
): DriftReport {
  const snapshotEntities = dataset.entities ?? [];
  const snapshotByTable = new Map(
    snapshotEntities.map((entity) => [lower(entity.key), entity]),
  );
  const boundTables = new Set<string>();

  const added: string[] = [];
  const removed: string[] = [];
  const changed: DriftChange[] = [];
  const entitiesRemoved: string[] = [];

  for (const entity of model.entities) {
    const binding = entity.bindings.find(
      (b) => b.kind === 'sql' || b.kind === 'rest',
    );
    if (!binding) continue;
    const address = bindingAddress(binding);
    if (!address) continue;
    boundTables.add(lower(address));

    const snapshot = snapshotByTable.get(lower(address));
    if (!snapshot) {
      // The table itself is gone — a different concern from a column drift.
      entitiesRemoved.push(entity.name);
      continue;
    }

    const columnsByName = new Map(
      snapshot.columns.map((column) => [lower(column.name), column]),
    );
    // Case-insensitive `attribute name -> physical column` lookup (finding
    // 11) — a plain object index on `binding.columns` would miss an
    // override whose key differs only in case from the attribute name.
    const overrides = new Map(
      Object.entries(binding.columns ?? {}).map(([attr, column]) => [
        lower(attr),
        column,
      ]),
    );
    const mappedPhysical = new Set<string>();
    for (const attribute of entity.attributes) {
      const physical = overrides.get(lower(attribute.name)) ?? attribute.name;
      mappedPhysical.add(lower(physical));
      const column = columnsByName.get(lower(physical));
      if (!column) {
        // The removed ref names the model's own attribute, not the physical
        // column it used to map to (finding 5) — `columns.<attr>` already
        // says what the stale physical name was, no need to duplicate it.
        removed.push(`${entity.name}.${lower(attribute.name)}`);
        continue;
      }
      const inferred = inferAttributeType(column.type);
      if (inferred !== attribute.type) {
        changed.push({
          ref: `${entity.name}.${attribute.name}`,
          from: attribute.type,
          to: inferred,
        });
      }
    }

    for (const column of snapshot.columns) {
      if (!mappedPhysical.has(lower(column.name))) {
        added.push(`${entity.name}.${safeName(column.name)}`);
      }
    }
  }

  const entityNames = deriveEntityNames(snapshotEntities);
  const entitiesAdded: string[] = [];
  for (const snapshot of snapshotEntities) {
    if (!boundTables.has(lower(snapshot.key))) {
      entitiesAdded.push(
        entityNames.get(snapshot.key) ?? safeName(lastSegment(snapshot.key)),
      );
    }
  }

  return {
    checkedAt: now,
    snapshotOf: model.version,
    added,
    removed,
    changed,
    entitiesAdded,
    entitiesRemoved,
  };
}
