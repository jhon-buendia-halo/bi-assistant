import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import { schemaSnapshotBlock } from '../../mastra/context-blocks';
import type { DatasetSnapshot } from '../../mastra/tool-services';
import {
  knowledgeBootstrapOutputSchema,
  MAX_BOOTSTRAP_DRAFTS,
} from '../../mastra/agents/knowledge-bootstrap.agent';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { KnowledgeRepository } from './repositories/knowledge.repository';
import {
  KNOWLEDGE_SNIPPET_KINDS,
  KnowledgeSnippet,
  KnowledgeSnippetInput,
  KnowledgeSnippetKind,
  KnowledgeSnippetScope,
  KnowledgeSnippetSource,
} from './entities/knowledge-snippet.entity';

/** Character budget the curated-knowledge system block may take per turn. */
const KNOWLEDGE_BLOCK_CHARS = 2_000;
/** Schema block budget/sample-value depth handed to the bootstrap agent. */
const BOOTSTRAP_SCHEMA_CHARS = 6_000;
const BOOTSTRAP_SCHEMA_SAMPLE_VALUES = 5;
/** Sample rows fetched per entity, and the total character budget for them. */
const BOOTSTRAP_SAMPLE_ROW_LIMIT = 5;
const BOOTSTRAP_SAMPLE_ROWS_CHARS = 4_000;

export interface KnowledgeQuery {
  /** A dataset's `name` — matches that dataset's scope plus any global snippet. */
  datasetId?: string;
  kind?: KnowledgeSnippetKind;
  source?: KnowledgeSnippetSource;
  enabled?: boolean;
}

/**
 * Genie-style curated knowledge: a small library of user-authored (and
 * agent-mined) business-glossary terms, standing instructions and default
 * filters, injected into the assistant's per-turn context as a fourth system
 * block alongside governed metrics, verified queries and entity orientation.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly mastra: MastraService,
  ) {}

  /**
   * `datasetId` scopes to that dataset plus every global (`scope: null`)
   * snippet; `kind`/`source`/`enabled` narrow further. Sorted `updatedAt`
   * desc (inherited from `KnowledgeRepository.list()`).
   */
  async list(query: KnowledgeQuery = {}): Promise<KnowledgeSnippet[]> {
    const all = await this.repository.list();
    return all.filter((snippet) => matchesQuery(snippet, query));
  }

  async create(input: KnowledgeSnippetInput): Promise<KnowledgeSnippet> {
    const clean = validateCreate(input);
    const now = new Date().toISOString();
    return this.repository.insert({
      id: randomUUID(),
      ...clean,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Partial update — only the fields present on `input` are validated and
   * applied; an absent field is left untouched (`KnowledgeRepository.update`
   * merges the patch over the stored document).
   */
  async update(
    id: string,
    input: Partial<KnowledgeSnippetInput>,
  ): Promise<KnowledgeSnippet> {
    const existing = await this.repository.get(id);
    if (!existing) {
      throw new NotFoundException(`Knowledge snippet ${id} not found`);
    }
    const patch = validateUpdate(input);
    const saved = await this.repository.update(id, patch);
    if (!saved) {
      throw new NotFoundException(`Knowledge snippet ${id} not found`);
    }
    return saved;
  }

  async delete(id: string): Promise<KnowledgeSnippet> {
    const existing = await this.repository.get(id);
    if (!existing) {
      throw new NotFoundException(`Knowledge snippet ${id} not found`);
    }
    await this.repository.delete(id);
    return existing;
  }

  /**
   * The system block appended to the analysis prompt: curated knowledge
   * covering `datasetIds` (scoped) plus anything global, or `''` when
   * nothing enabled applies. Mirrors `MetricsService.definitionBlock`'s
   * shape: budgeted, most-relevant-first.
   */
  async definitionBlock(datasetIds: string[]): Promise<string> {
    const scope = new Set(datasetIds);
    const all = await this.repository.list(); // already updatedAt desc
    const applicable = all.filter(
      (snippet) =>
        snippet.enabled &&
        (snippet.scope == null ||
          (snippet.scope.datasetId !== undefined &&
            scope.has(snippet.scope.datasetId))),
    );
    if (!applicable.length) return '';
    // Stable sort: dataset-scoped before global, `updatedAt desc` preserved
    // within each group since `all` already carries that order.
    const ordered = [...applicable].sort(
      (a, b) => rank(a.scope) - rank(b.scope),
    );
    const lines = [
      'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):',
    ];
    let budget = KNOWLEDGE_BLOCK_CHARS;
    for (const snippet of ordered) {
      const entry = formatSnippet(snippet);
      if (entry.length > budget) break;
      budget -= entry.length;
      lines.push(entry);
    }
    return lines.length > 1 ? lines.join('\n') : '';
  }

  /**
   * Mine a first pass of knowledge drafts from a dataset's schema and sample
   * data via the `knowledge-bootstrap` agent, and persist them disabled
   * (`source: 'mined'`) for a human to review. Never throws a raw error —
   * any failure (missing dataset, LLM error, malformed output) surfaces as
   * a `BadRequestException` with a clear message.
   */
  async bootstrap(datasetId: string): Promise<KnowledgeSnippet[]> {
    const id = (datasetId ?? '').trim();
    if (!id) throw new BadRequestException('datasetId is required');

    const datasets = await this.boundDatasets([id]);
    if (!datasets.length) {
      throw new BadRequestException(`Dataset "${id}" not found`);
    }

    let drafts: {
      kind: KnowledgeSnippetKind;
      title: string;
      body: string;
      synonyms?: string[];
      entities?: string[];
    }[];
    try {
      const schema = schemaSnapshotBlock(datasets, {
        budgetChars: BOOTSTRAP_SCHEMA_CHARS,
        sampleValues: BOOTSTRAP_SCHEMA_SAMPLE_VALUES,
      });
      const sampleRows = await this.gatherSampleRows(datasets);
      const result = await this.mastra.getAgent('knowledge-bootstrap').generate(
        [
          'Draft knowledge snippets for the dataset below.',
          '',
          '<entity-schemas>',
          schema || '(no schema snapshot stored for this dataset)',
          '</entity-schemas>',
          '',
          '<sample-rows>',
          sampleRows || '(no sample rows available)',
          '</sample-rows>',
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
      const parsed = knowledgeBootstrapOutputSchema.safeParse(
        (result as { object?: unknown }).object ??
          parseJsonObject((result as { text?: string }).text),
      );
      if (!parsed.success) {
        throw new Error('the bootstrap agent returned no usable drafts');
      }
      drafts = parsed.data.drafts;
    } catch (err) {
      throw new BadRequestException(
        `Knowledge bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const existing = await this.repository.list();
    const existingTitles = new Set(
      existing
        .filter((snippet) => snippet.scope?.datasetId === id)
        .map((snippet) => snippet.title.trim().toLowerCase()),
    );
    const created: KnowledgeSnippet[] = [];
    for (const draft of drafts.slice(0, MAX_BOOTSTRAP_DRAFTS)) {
      const title = (draft.title ?? '').trim();
      if (!title || existingTitles.has(title.toLowerCase())) continue;
      existingTitles.add(title.toLowerCase());
      const synonyms = (draft.synonyms ?? [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      const entities = (draft.entities ?? [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      const now = new Date().toISOString();
      created.push(
        await this.repository.insert({
          id: randomUUID(),
          kind: draft.kind,
          scope: { datasetId: id },
          title,
          body: (draft.body ?? '').trim(),
          ...(synonyms.length ? { synonyms } : {}),
          ...(entities.length ? { entities } : {}),
          enabled: false,
          source: 'mined',
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return created;
  }

  /**
   * Datasets created before datasources existed carry no binding — attach
   * the preferred saved datasource so the schema/sample-row calls still
   * work. Mirrors `SessionsService.boundDatasets`.
   */
  private async boundDatasets(names: string[]): Promise<DatasetSnapshot[]> {
    const datasets = await this.datasetsRepository.getByNames(names);
    if (datasets.every((s) => s.datasourceId)) return datasets;
    const fallback = await this.datasourcesService.defaultDatasource();
    return datasets.map((s) =>
      s.datasourceId || !fallback
        ? s
        : { ...s, datasourceId: fallback.id, datasourceKind: fallback.kind },
    );
  }

  /** A few real rows per entity — best-effort; a sampling failure just means less context for that entity. */
  private async gatherSampleRows(datasets: DatasetSnapshot[]): Promise<string> {
    const blocks: string[] = [];
    let budget = BOOTSTRAP_SAMPLE_ROWS_CHARS;
    for (const dataset of datasets) {
      if (!dataset.datasourceId) continue;
      for (const key of dataset.tables) {
        try {
          const { rows } = await this.datasourcesService.sampleRows(
            dataset.datasourceId,
            key,
            BOOTSTRAP_SAMPLE_ROW_LIMIT,
          );
          if (!rows.length) continue;
          const block = `${key}:\n${JSON.stringify(rows.slice(0, BOOTSTRAP_SAMPLE_ROW_LIMIT))}`;
          if (block.length > budget) continue;
          budget -= block.length;
          blocks.push(block);
        } catch {
          // best-effort — schema alone is still useful context
        }
      }
    }
    return blocks.join('\n\n');
  }
}

/** 0 = dataset-scoped, 1 = global — dataset-scoped sorts first. */
function rank(scope: KnowledgeSnippetScope | null): number {
  return scope?.datasetId ? 0 : 1;
}

function matchesQuery(
  snippet: KnowledgeSnippet,
  query: KnowledgeQuery,
): boolean {
  if (query.kind && snippet.kind !== query.kind) return false;
  if (query.source && snippet.source !== query.source) return false;
  if (query.enabled !== undefined && snippet.enabled !== query.enabled) {
    return false;
  }
  if (query.datasetId) {
    const scopedToDataset = snippet.scope?.datasetId === query.datasetId;
    const isGlobal = snippet.scope == null;
    if (!scopedToDataset && !isGlobal) return false;
  }
  return true;
}

/** One compact line per snippet: kind tag, title, body, then optional extras. */
function formatSnippet(snippet: KnowledgeSnippet): string {
  const synonyms = snippet.synonyms?.length
    ? `; synonyms: ${snippet.synonyms.join(', ')}`
    : '';
  const entities = snippet.entities?.length
    ? `; entities: ${snippet.entities.join(', ')}`
    : '';
  return `- [${snippet.kind}] ${snippet.title}: ${snippet.body}${synonyms}${entities}`;
}

function normalizeScope(scope: unknown): KnowledgeSnippetScope | null {
  if (scope === null || scope === undefined) return null;
  if (typeof scope !== 'object') return null;
  const raw = scope as Record<string, unknown>;
  const datasetId =
    typeof raw.datasetId === 'string' ? raw.datasetId.trim() : undefined;
  const datasourceId =
    typeof raw.datasourceId === 'string' ? raw.datasourceId.trim() : undefined;
  if (!datasetId && !datasourceId) return null;
  return {
    ...(datasetId ? { datasetId } : {}),
    ...(datasourceId ? { datasourceId } : {}),
  };
}

function normalizeList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/** Full validation for `create` — every required field must be present. */
function validateCreate(
  input: KnowledgeSnippetInput,
): Pick<
  KnowledgeSnippet,
  | 'kind'
  | 'scope'
  | 'title'
  | 'body'
  | 'synonyms'
  | 'entities'
  | 'enabled'
> {
  const kind = input?.kind;
  if (!KNOWLEDGE_SNIPPET_KINDS.includes(kind)) {
    throw new BadRequestException(
      `kind must be one of: ${KNOWLEDGE_SNIPPET_KINDS.join(', ')}`,
    );
  }
  const title = String(input?.title ?? '').trim();
  if (!title) throw new BadRequestException('title is required');
  const body = String(input?.body ?? '').trim();
  if (!body) throw new BadRequestException('body is required');
  const synonyms = normalizeList(input?.synonyms);
  const entities = normalizeList(input?.entities);
  return {
    kind,
    scope: normalizeScope(input?.scope),
    title,
    body,
    ...(synonyms.length ? { synonyms } : {}),
    ...(entities.length ? { entities } : {}),
    enabled: input?.enabled ?? true,
  } as Pick<
    KnowledgeSnippet,
    'kind' | 'scope' | 'title' | 'body' | 'synonyms' | 'entities' | 'enabled'
  >;
}

/** Partial validation for `update` — only fields present on `input` are checked/applied. */
function validateUpdate(
  input: Partial<KnowledgeSnippetInput>,
): Partial<KnowledgeSnippet> {
  const patch: Partial<KnowledgeSnippet> = {};
  if (input.kind !== undefined) {
    if (!KNOWLEDGE_SNIPPET_KINDS.includes(input.kind)) {
      throw new BadRequestException(
        `kind must be one of: ${KNOWLEDGE_SNIPPET_KINDS.join(', ')}`,
      );
    }
    patch.kind = input.kind;
  }
  if (input.scope !== undefined) patch.scope = normalizeScope(input.scope);
  if (input.title !== undefined) {
    const title = String(input.title ?? '').trim();
    if (!title) throw new BadRequestException('title must not be empty');
    patch.title = title;
  }
  if (input.body !== undefined) {
    const body = String(input.body ?? '').trim();
    if (!body) throw new BadRequestException('body must not be empty');
    patch.body = body;
  }
  if (input.synonyms !== undefined) {
    patch.synonyms = normalizeList(input.synonyms);
  }
  if (input.entities !== undefined) {
    patch.entities = normalizeList(input.entities);
  }
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  return patch;
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
