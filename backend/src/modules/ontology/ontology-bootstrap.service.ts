import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import { schemaSnapshotBlock } from '../../mastra/context-blocks';
import type { DatasetSnapshot } from '../../mastra/tool-services';
import {
  knowledgeBootstrapOutputSchema,
  MAX_BOOTSTRAP_DRAFTS,
  ontologyDraftSchema,
  type OntologyDraft,
} from '../../mastra/agents/knowledge-bootstrap.agent';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { MetricsService } from '../metrics/metrics.service';
import type { MetricDoc } from '../metrics/entities/metric.entity';
import { OntologyRepository } from './repositories/ontology.repository';
import type {
  ConceptMapping,
  OntologyItem,
  OntologyKind,
} from './entities/ontology-item.entity';

/** Schema block budget/sample-value depth handed to the bootstrap agent. */
const BOOTSTRAP_SCHEMA_CHARS = 6_000;
const BOOTSTRAP_SCHEMA_SAMPLE_VALUES = 5;
/** Sample rows fetched per entity, and the total character budget for them. */
const BOOTSTRAP_SAMPLE_ROW_LIMIT = 5;
const BOOTSTRAP_SAMPLE_ROWS_CHARS = 4_000;
/** Budgets for the column-reference, metric and existing-concept blocks. */
const BOOTSTRAP_RELATIONSHIPS_CHARS = 2_000;
const BOOTSTRAP_METRICS_CHARS = 2_000;
const BOOTSTRAP_CONCEPTS_CHARS = 1_500;

/** A bootstrap stage, streamed as `{ type: 'progress', key, message }`. */
export interface OntologyBootstrapProgress {
  key: 'dataset' | 'schema' | 'sample' | 'draft' | 'save';
  message: string;
}

/**
 * Drafts ontology items for one dataset with the `knowledge-bootstrap` agent
 * (docs/plans/ba-320-dataset-ontology.md, "Bootstrap") and persists them
 * disabled (`source: 'mined'`) for a human to review in the dataset's
 * Ontology tab. Never throws a raw error — any failure (missing dataset, LLM
 * error, malformed output) surfaces as a `BadRequestException` with a clear
 * message, and nothing is persisted.
 */
@Injectable()
export class OntologyBootstrapService {
  constructor(
    private readonly repository: OntologyRepository,
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly metricsService: MetricsService,
    private readonly mastra: MastraService,
  ) {}

  /**
   * `onProgress` (optional) is called as each stage starts, so a streaming
   * caller can tell the user what the run is doing during the minute it takes.
   */
  async bootstrap(
    datasetName: string,
    onProgress?: (progress: OntologyBootstrapProgress) => void,
  ): Promise<OntologyItem[]> {
    const report = (progress: OntologyBootstrapProgress) =>
      onProgress?.(progress);
    const name = (datasetName ?? '').trim();
    if (!name) throw new BadRequestException('dataset is required');

    report({ key: 'dataset', message: `Opening dataset “${name}”` });
    const [dataset] = await this.boundDatasets([name]);
    if (!dataset) {
      throw new BadRequestException(`Dataset "${name}" not found`);
    }

    let drafts: OntologyDraft[];
    let metrics: MetricDoc[];
    let existing: OntologyItem[];
    try {
      const tableCount = dataset.tables.length;
      report({
        key: 'schema',
        message: `Reading schema — ${tableCount} ${plural(tableCount, 'table')}`,
      });
      const schema = schemaSnapshotBlock([dataset], {
        budgetChars: BOOTSTRAP_SCHEMA_CHARS,
        sampleValues: BOOTSTRAP_SCHEMA_SAMPLE_VALUES,
      });
      const relationships = relationshipsBlock(dataset);
      metrics = await this.metricsService.listForEntities(dataset.tables);
      existing = (await this.repository.list()).filter((item) =>
        inOntology(item, name),
      );
      const sampleRows = await this.gatherSampleRows(dataset, (done, total) =>
        report({
          key: 'sample',
          message: `Sampling rows — ${done} of ${total} ${plural(total, 'table')}`,
        }),
      );
      report({
        key: 'draft',
        message: 'Drafting concepts, relations, constraints and instructions',
      });
      const result = await this.mastra
        .getAgent('knowledge-bootstrap')
        .generate(
          [
            'Draft ontology items for the dataset below.',
            '',
            '<entity-schemas>',
            schema || '(no schema snapshot stored for this dataset)',
            '</entity-schemas>',
            '',
            '<sample-rows>',
            sampleRows || '(no sample rows available)',
            '</sample-rows>',
            '',
            '<relationships>',
            relationships || '(no column references known for this dataset)',
            '</relationships>',
            '',
            '<metrics>',
            metricsBlock(metrics) || '(no governed metrics on these tables)',
            '</metrics>',
            '',
            '<existing-concepts>',
            existingConceptsBlock(existing) || '(none yet)',
            '</existing-concepts>',
          ].join('\n'),
          {
            maxSteps: 1,
            toolChoice: 'none',
            structuredOutput: {
              schema: knowledgeBootstrapOutputSchema,
              jsonPromptInjection: 'inline',
            },
          },
        );
      drafts = usableDrafts(
        (result as { object?: unknown }).object ??
          parseJsonObject((result as { text?: string }).text),
      );
    } catch (err) {
      throw new BadRequestException(
        `Ontology bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Resolve everything in memory first, so a draft that cannot be saved
    // never leaves half a run behind and the save line states the real count.
    const items = planItems(drafts, dataset, metrics, existing);
    report({
      key: 'save',
      message: `Saving ${items.length} ${plural(items.length, 'draft')} for review`,
    });
    const created: OntologyItem[] = [];
    for (const item of items) {
      created.push(await this.repository.insert(item));
    }
    return created;
  }

  /**
   * Datasets created before datasources existed carry no binding — attach
   * the preferred saved datasource so the sample-row calls still work.
   * Mirrors `SessionsService.boundDatasets`.
   */
  private async boundDatasets(names: string[]): Promise<DatasetSnapshot[]> {
    const datasets: DatasetSnapshot[] =
      await this.datasetsRepository.getByNames(names);
    if (datasets.every((s) => s.datasourceId)) return datasets;
    const fallback = await this.datasourcesService.defaultDatasource();
    return datasets.map((s) =>
      s.datasourceId || !fallback
        ? s
        : { ...s, datasourceId: fallback.id, datasourceKind: fallback.kind },
    );
  }

  /** A few real rows per entity — best-effort; a sampling failure just means less context for that entity. */
  private async gatherSampleRows(
    dataset: DatasetSnapshot,
    onTable?: (done: number, total: number) => void,
  ): Promise<string> {
    if (!dataset.datasourceId) return '';
    const blocks: string[] = [];
    let budget = BOOTSTRAP_SAMPLE_ROWS_CHARS;
    const total = dataset.tables.length;
    let done = 0;
    for (const table of dataset.tables) {
      onTable?.(++done, total);
      try {
        const { rows } = await this.datasourcesService.sampleRows(
          dataset.datasourceId,
          table,
          BOOTSTRAP_SAMPLE_ROW_LIMIT,
        );
        if (!rows.length) continue;
        const block = `${table}:\n${JSON.stringify(rows.slice(0, BOOTSTRAP_SAMPLE_ROW_LIMIT))}`;
        if (block.length > budget) continue;
        budget -= block.length;
        blocks.push(block);
      } catch {
        // best-effort — schema alone is still useful context
      }
    }
    return blocks.join('\n\n');
  }
}

/** `1 table` / `3 tables` — progress lines read badly without it. */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/** Items the dataset's Ontology tab shows: its own plus the shared ones. */
function inOntology(item: OntologyItem, dataset: string): boolean {
  return item.dataset === dataset || item.dataset === null;
}

/** Case-insensitive lookup key for names and entities. */
function key(value: string): string {
  return value.trim().toLowerCase();
}

/** Keep `lines` while they fit in `budget` characters; stop at the first that does not. */
function budgeted(lines: string[], budget: number): string {
  const kept: string[] = [];
  let left = budget;
  for (const line of lines) {
    if (line.length > left) break;
    left -= line.length;
    kept.push(line);
  }
  return kept.join('\n');
}

/** `orders.customer_id -> customers.id (declared)`, one per referencing column. */
function relationshipsBlock(dataset: DatasetSnapshot): string {
  const lines: string[] = [];
  for (const table of dataset.tables) {
    const columns =
      dataset.entities?.find((e) => e.key === table)?.columns ?? [];
    for (const column of columns) {
      const ref = column.references;
      if (!ref) continue;
      lines.push(
        `${table}.${column.name} -> ${ref.entity}.${ref.column} (${ref.source})`,
      );
    }
  }
  return budgeted(lines, BOOTSTRAP_RELATIONSHIPS_CHARS);
}

/** `denial_rate — Denial rate (catalog.schema.claims)`. */
function metricsBlock(metrics: MetricDoc[]): string {
  return budgeted(
    metrics.map((m) => `${m.name} — ${m.label} (${m.entity})`),
    BOOTSTRAP_METRICS_CHARS,
  );
}

function existingConceptsBlock(existing: OntologyItem[]): string {
  return budgeted(
    existing
      .filter((item) => item.kind === 'concept')
      .map((item) => `- ${item.name}`),
    BOOTSTRAP_CONCEPTS_CHARS,
  );
}

/**
 * The drafts that match the schema. A single malformed draft is skipped
 * rather than failing the run; a reply with no drafts list, or none that
 * parse, is a failure. The `MAX_BOOTSTRAP_DRAFTS` cap is applied after
 * planning (`planItems`), so dropped duplicates don't use up the budget.
 */
function usableDrafts(output: unknown): OntologyDraft[] {
  const raw = (output as { drafts?: unknown } | undefined)?.drafts;
  if (!Array.isArray(raw)) {
    throw new Error('the bootstrap agent returned no usable drafts');
  }
  const drafts: OntologyDraft[] = [];
  for (const entry of raw) {
    const parsed = ontologyDraftSchema.safeParse(entry);
    if (parsed.success) drafts.push(parsed.data);
  }
  if (raw.length > 0 && drafts.length === 0) {
    throw new Error('the bootstrap agent returned no usable drafts');
  }
  return drafts;
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Turns drafts into the items to insert (docs/plans/ba-320-dataset-ontology.md,
 * "Bootstrap" post-processing): concepts first; relation endpoints resolved by
 * name (case-insensitive) against this run's and the ontology's concepts,
 * metrics by name; unresolved relations dropped; mappings outside the
 * dataset's tables dropped; a name already used for the same kind (in the
 * ontology or earlier in the run) dropped. Every item belongs to the dataset,
 * is `mined` and disabled.
 */
function planItems(
  drafts: OntologyDraft[],
  dataset: DatasetSnapshot,
  metrics: MetricDoc[],
  existing: OntologyItem[],
): OntologyItem[] {
  const tables = new Map(dataset.tables.map((t) => [key(t), t]));
  const canonicalEntities = (values: string[] | undefined) => [
    ...new Set(
      cleanList(values)
        .map((v) => tables.get(key(v)))
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const takenNames = new Map<OntologyKind, Set<string>>();
  const taken = (kind: OntologyKind) => {
    let set = takenNames.get(kind);
    if (!set) takenNames.set(kind, (set = new Set()));
    return set;
  };
  for (const item of existing) taken(item.kind).add(key(item.name));
  const conceptIds = new Map<string, { id: string; name: string }>();
  for (const item of existing) {
    if (item.kind === 'concept') {
      conceptIds.set(key(item.name), { id: item.id, name: item.name });
    }
  }
  const metricByName = new Map(metrics.map((m) => [key(m.name), m]));
  const relationKeys = new Set(
    existing
      .filter((item) => item.kind === 'relation')
      .map((item) => `${item.from}|${item.type}|${item.to ?? item.metricId}`),
  );

  const now = new Date().toISOString();
  const base = (kind: OntologyKind, name: string) => ({
    id: randomUUID(),
    dataset: dataset.name,
    kind,
    name,
    enabled: false,
    source: 'mined' as const,
    createdAt: now,
    updatedAt: now,
  });

  const items: OntologyItem[] = [];
  const ordered = [
    ...drafts.filter((d) => d.kind === 'concept'),
    ...drafts.filter((d) => d.kind !== 'concept'),
  ];
  for (const draft of ordered) {
    if (draft.kind === 'relation') {
      const from = conceptIds.get(key(draft.from));
      if (!from) continue;
      let target: { id: string; name: string; metric: boolean } | undefined;
      if (draft.type === 'measured-by') {
        const metric = metricByName.get(key(draft.metric ?? ''));
        if (metric)
          target = { id: metric.id, name: metric.label, metric: true };
      } else {
        const to = conceptIds.get(key(draft.to ?? ''));
        if (to && to.id !== from.id) target = { ...to, metric: false };
      }
      if (!target) continue;
      const tuple = `${from.id}|${draft.type}|${target.id}`;
      const name = `${from.name} ${draft.type} ${target.name}`;
      if (relationKeys.has(tuple) || taken('relation').has(key(name))) continue;
      relationKeys.add(tuple);
      taken('relation').add(key(name));
      items.push({
        ...base('relation', name),
        description: '',
        from: from.id,
        type: draft.type,
        ...(target.metric ? { metricId: target.id } : { to: target.id }),
      });
      continue;
    }

    const name = draft.name.trim();
    if (!name || taken(draft.kind).has(key(name))) continue;

    if (draft.kind === 'concept') {
      const description = draft.description.trim();
      if (!description) continue;
      const synonyms = cleanList(draft.synonyms);
      const mappings: ConceptMapping[] = [];
      for (const mapping of draft.mappings ?? []) {
        const entity = tables.get(key(mapping.entity ?? ''));
        if (!entity) continue;
        const column = (mapping.column ?? '').trim();
        const expression = (mapping.expression ?? '').trim();
        mappings.push({
          entity,
          ...(column ? { column } : {}),
          ...(expression ? { expression } : {}),
        });
      }
      const item: OntologyItem = {
        ...base('concept', name),
        description,
        ...(synonyms.length ? { synonyms } : {}),
        ...(mappings.length ? { mappings } : {}),
      };
      taken('concept').add(key(name));
      conceptIds.set(key(name), { id: item.id, name });
      items.push(item);
    } else if (draft.kind === 'constraint') {
      const predicate = draft.predicate.trim();
      if (!predicate) continue;
      const entities = canonicalEntities(draft.entities);
      taken('constraint').add(key(name));
      items.push({
        ...base('constraint', name),
        description: (draft.description ?? '').trim(),
        predicate,
        ...(entities.length ? { entities } : {}),
      });
    } else {
      const description = draft.description.trim();
      if (!description) continue;
      const entities = canonicalEntities(draft.entities);
      taken('instruction').add(key(name));
      items.push({
        ...base('instruction', name),
        description,
        ...(entities.length ? { entities } : {}),
      });
    }
  }
  return items.slice(0, MAX_BOOTSTRAP_DRAFTS);
}

/** Parse a model's JSON reply, tolerating a markdown fence around it —
 * duplicated (not imported) so this module stays usable without pulling in
 * `SessionsService`/`DeepAnalysisService`; same reasoning as the identical
 * helper in `assistant.evals.ts`. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
