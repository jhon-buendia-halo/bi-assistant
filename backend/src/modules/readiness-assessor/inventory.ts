// Source inventory (skill readiness-source-inventory): the critical entities
// of the scope resolved against the session's datasets, with their columns,
// semantic types, schema notes and layers. Pure.
import type {
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from '../../mastra/tool-services';
import type { DatasourceKind } from '../datasources/entities/datasource.entity';
import {
  classifyDatabricksType,
  classifyType,
} from '../synthetic-data/profile/classify-type';
import type { SemanticType } from '../synthetic-data/types';
import type { ReadinessScope } from './readiness.types';

export interface InventoryEntity {
  /** The key as the scope names it (or the dataset's key when the scope lists none). */
  key: string;
  /** The key as the dataset names it (what SQL and `sampleRows` take). */
  datasetKey: string;
  dataset: string;
  datasourceId?: string;
  kind?: DatasourceKind;
  /** False when no dataset holds it: D1 = 0. */
  found: boolean;
  /** False when the dataset lists the table but no column metadata. */
  columnsKnown: boolean;
  columns: DatasetColumnSnapshot[];
  layer?: 'landing' | 'normalized' | 'consumption';
  schemaDescription?: string;
}

export interface Inventory {
  entities: InventoryEntity[];
  /** Requested dataset names the host did not resolve. */
  missingDatasets: string[];
}

/** The semantic type of a column, whatever the dialect's spelling. */
export function semanticType(
  column: DatasetColumnSnapshot,
  kind?: DatasourceKind,
): SemanticType {
  if (kind === 'databricks') return classifyDatabricksType(column.type);
  const t = classifyType(column.type);
  return t === 'other' ? classifyDatabricksType(column.type) : t;
}

interface Candidate {
  dataset: DatasetSnapshot;
  key: string;
  columns?: DatasetColumnSnapshot[];
}

function candidates(datasets: DatasetSnapshot[]): Candidate[] {
  const out: Candidate[] = [];
  for (const dataset of datasets) {
    const seen = new Set<string>();
    for (const e of dataset.entities ?? []) {
      seen.add(e.key.toLowerCase());
      out.push({ dataset, key: e.key, columns: e.columns });
    }
    for (const t of dataset.tables) {
      if (!seen.has(t.toLowerCase())) out.push({ dataset, key: t });
    }
  }
  return out;
}

/** Exact, then case-insensitive, then a unique match on a `.` boundary. */
function resolve(key: string, all: Candidate[]): Candidate | undefined {
  const exact = all.find((c) => c.key === key);
  if (exact) return exact;
  const lower = key.toLowerCase();
  const ci = all.find((c) => c.key.toLowerCase() === lower);
  if (ci) return ci;
  const suffix = all.filter((c) => c.key.toLowerCase().endsWith(`.${lower}`));
  return suffix.length === 1 ? suffix[0] : undefined;
}

function schemaNote(dataset: DatasetSnapshot, key: string) {
  const lower = key.toLowerCase();
  return (dataset.schemas ?? [])
    .filter((s) => lower.startsWith(`${s.key.toLowerCase()}.`))
    .sort((a, b) => b.key.length - a.key.length)[0];
}

function toEntity(key: string, c: Candidate): InventoryEntity {
  const note = schemaNote(c.dataset, c.key);
  return {
    key,
    datasetKey: c.key,
    dataset: c.dataset.name,
    datasourceId: c.dataset.datasourceId,
    kind: c.dataset.datasourceKind,
    found: true,
    columnsKnown: (c.columns?.length ?? 0) > 0,
    columns: c.columns ?? [],
    layer: note?.layer,
    schemaDescription: note?.description?.trim() || undefined,
  };
}

export function buildInventory(
  scope: ReadinessScope,
  requested: string[],
  datasets: DatasetSnapshot[],
): Inventory {
  const all = candidates(datasets);
  const names = new Set(datasets.map((d) => d.name));
  const missingDatasets = requested.filter((n) => !names.has(n)).sort();
  const keys = scope.entities.length
    ? [...new Set(scope.entities)]
    : [...new Set(all.map((c) => c.key))];
  const entities = keys.sort().map((key): InventoryEntity => {
    const hit = resolve(key, all);
    if (hit) return toEntity(key, hit);
    return {
      key,
      datasetKey: key,
      dataset: requested.length === 1 ? requested[0] : '',
      found: false,
      columnsKnown: false,
      columns: [],
    };
  });
  return { entities, missingDatasets };
}

export function findColumn(
  entity: InventoryEntity,
  name: string,
): DatasetColumnSnapshot | undefined {
  const lower = name.toLowerCase();
  return entity.columns.find((c) => c.name.toLowerCase() === lower);
}

/** Scope fields of this entity (matched on either key spelling). */
export function belongsTo(entity: InventoryEntity, key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === entity.key.toLowerCase() || k === entity.datasetKey.toLowerCase()
  );
}

/** The grain key: the scope's, else a column named `id`. */
export function grainKey(
  scope: ReadinessScope,
  entity: InventoryEntity,
): string[] {
  const declared = scope.grainKeys?.find((g) => belongsTo(entity, g.entity));
  if (declared?.columns.length) return declared.columns;
  const id = findColumn(entity, 'id');
  return id ? [id.name] : [];
}

/** Date and timestamp columns (not intervals or times of day), for freshness and windows. */
export function dateColumns(entity: InventoryEntity): DatasetColumnSnapshot[] {
  return entity.columns.filter(
    (c) =>
      semanticType(c, entity.kind) === 'temporal' &&
      /^(date|timestamp|datetime)/i.test(c.type.trim()),
  );
}
