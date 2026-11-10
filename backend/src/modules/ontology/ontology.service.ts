import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { MetricsService } from '../metrics/metrics.service';
import { OntologyRepository } from './repositories/ontology.repository';
import {
  ONTOLOGY_KINDS,
  RELATION_TYPES,
} from './entities/ontology-item.entity';
import type {
  ConceptMapping,
  KnowledgeUse,
  KnowledgeUseKind,
  OntologyItem,
  OntologyItemInput,
  OntologyKind,
  OntologySource,
} from './entities/ontology-item.entity';

/** Character budget the per-turn ontology block may take (header not counted). */
const KNOWLEDGE_BLOCK_CHARS = 2_000;
const BLOCK_HEADER =
  'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):';

/** The tag each kind carries in the block and in `KnowledgeUse.kind`. */
const KIND_TAG: Record<OntologyKind, KnowledgeUseKind> = {
  concept: 'term',
  constraint: 'default_filter',
  instruction: 'instruction',
  relation: 'relation',
};

export interface OntologyQuery {
  kind?: OntologyKind;
  source?: OntologySource;
  enabled?: boolean;
}

/** The fields an item of each kind keeps besides the common ones. */
type KindFields = Pick<
  OntologyItem,
  | 'synonyms'
  | 'mappings'
  | 'predicate'
  | 'conceptId'
  | 'entities'
  | 'from'
  | 'type'
  | 'to'
  | 'metricId'
>;

/**
 * Each dataset's ontology: concepts, relations, constraints and instructions
 * (ADR-0036). Items belong to one dataset or are shared by every dataset.
 * The enabled items covering a session's datasets go into the assistant's
 * per-turn context as the curated-knowledge block.
 */
@Injectable()
export class OntologyService {
  constructor(
    private readonly repository: OntologyRepository,
    private readonly datasetsRepository: DatasetsRepository,
    private readonly metrics: MetricsService,
  ) {}

  /** The items of `datasetName` plus every shared item, newest first. */
  async list(
    datasetName: string,
    query: OntologyQuery = {},
  ): Promise<OntologyItem[]> {
    await this.requireDataset(datasetName);
    const all = await this.repository.list();
    return all.filter(
      (item) =>
        (item.dataset === datasetName || item.dataset === null) &&
        (!query.kind || item.kind === query.kind) &&
        (!query.source || item.source === query.source) &&
        (query.enabled === undefined || item.enabled === query.enabled),
    );
  }

  async create(
    datasetName: string,
    input: OntologyItemInput,
  ): Promise<OntologyItem> {
    const tables = await this.requireDataset(datasetName);
    const raw = input ?? {};
    const kind = parseKind(raw.kind);
    const dataset = raw.shared === true ? null : datasetName;
    const name = optionalText(raw.name);
    if (!name && kind !== 'relation') {
      throw new BadRequestException('name is required');
    }
    const description = optionalText(raw.description);
    if (!description && (kind === 'concept' || kind === 'instruction')) {
      throw new BadRequestException('description is required');
    }
    const fields = await this.kindFields(kind, raw, {
      dataset,
      tables,
      isCreate: true,
    });
    const now = new Date().toISOString();
    return this.repository.insert({
      id: randomUUID(),
      dataset,
      kind,
      name: name || (await this.relationLabel(fields)),
      description,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      source: 'user',
      ...fields,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Partial update: only the fields present on `input` are validated and
   * applied; the rest keep their stored value. `kind` cannot change, fields
   * of another kind are dropped, and `updatedAt` is restamped.
   */
  async update(id: string, input: OntologyItemInput): Promise<OntologyItem> {
    const existing = await this.requireItem(id);
    const raw = input ?? {};
    if (raw.kind !== undefined && parseKind(raw.kind) !== existing.kind) {
      throw new BadRequestException('kind cannot be changed');
    }
    const kind = existing.kind;
    let name = existing.name;
    if (raw.name !== undefined) {
      name = optionalText(raw.name);
      if (!name) throw new BadRequestException('name must not be empty');
    }
    let description = existing.description ?? '';
    if (raw.description !== undefined) {
      description = optionalText(raw.description);
      if (!description && (kind === 'concept' || kind === 'instruction')) {
        throw new BadRequestException('description must not be empty');
      }
    }
    const tables =
      existing.dataset === null
        ? null
        : ((await this.datasetsRepository.getByNames([existing.dataset]))[0]
            ?.tables ?? []);
    const fields = await this.kindFields(
      kind,
      { ...pickKindFields(existing), ...definedOnly(raw) },
      { dataset: existing.dataset, tables, isCreate: false, raw },
    );
    if (
      kind === 'relation' &&
      raw.name === undefined &&
      (raw.from !== undefined ||
        raw.to !== undefined ||
        raw.type !== undefined ||
        raw.metricId !== undefined)
    ) {
      name = await this.relationLabel(fields);
    }
    const next: Omit<OntologyItem, 'createdAt' | 'updatedAt'> = {
      id: existing.id,
      dataset: existing.dataset,
      kind,
      name,
      description,
      enabled:
        raw.enabled !== undefined ? Boolean(raw.enabled) : existing.enabled,
      source: existing.source,
      ...fields,
      ...(existing.ownerId !== undefined ? { ownerId: existing.ownerId } : {}),
    };
    const saved = await this.repository.replace(id, next);
    if (!saved) throw new NotFoundException(`Ontology item ${id} not found`);
    return saved;
  }

  /**
   * Remove an item. A concept takes its relations (from or to it) with it,
   * and constraints that named it lose their `conceptId`.
   */
  async delete(id: string): Promise<OntologyItem> {
    const existing = await this.requireItem(id);
    if (existing.kind === 'concept') {
      const all = await this.repository.list();
      for (const item of all) {
        if (item.kind === 'relation' && (item.from === id || item.to === id)) {
          await this.repository.delete(item.id);
        } else if (item.kind === 'constraint' && item.conceptId === id) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { conceptId, createdAt, updatedAt, ...rest } = item;
          await this.repository.replace(item.id, rest);
        }
      }
    }
    await this.repository.delete(id);
    return existing;
  }

  /**
   * The curated-knowledge system block for a turn over `datasetNames`, or
   * `''` when no enabled item applies.
   */
  async definitionBlock(datasetNames: string[]): Promise<string> {
    return (await this.contextFor(datasetNames)).block;
  }

  /**
   * `definitionBlock` plus the per-item record of what went into it. Enabled
   * items of the session's datasets come first, then shared ones, newest
   * `updatedAt` first within each; lines stop at the first one that does not
   * fit the budget, and `used` lists exactly the lines in the block.
   */
  async contextFor(
    datasetNames: string[],
  ): Promise<{ block: string; used: KnowledgeUse[] }> {
    const empty = { block: '', used: [] as KnowledgeUse[] };
    const scope = new Set(datasetNames);
    const all = await this.repository.list(); // already updatedAt desc
    const applicable = all.filter(
      (item) =>
        item.enabled && (item.dataset === null || scope.has(item.dataset)),
    );
    if (!applicable.length) return empty;
    // Stable sort: dataset items before shared ones, recency kept within each.
    const ordered = [...applicable].sort(
      (a, b) => (a.dataset === null ? 1 : 0) - (b.dataset === null ? 1 : 0),
    );
    const concepts = new Map(
      all.filter((i) => i.kind === 'concept').map((i) => [i.id, i.name]),
    );
    const metricLabels = ordered.some(
      (i) => i.kind === 'relation' && i.type === 'measured-by',
    )
      ? new Map((await this.metrics.list()).map((m) => [m.id, m.label]))
      : new Map<string, string>();
    const lines = [BLOCK_HEADER];
    const used: KnowledgeUse[] = [];
    let budget = KNOWLEDGE_BLOCK_CHARS;
    for (const item of ordered) {
      const rendered = renderItem(item, concepts, metricLabels);
      if (!rendered) continue;
      if (rendered.line.length > budget) break;
      budget -= rendered.line.length;
      lines.push(rendered.line);
      used.push({
        id: item.id,
        kind: KIND_TAG[item.kind],
        title: item.name,
        body: rendered.body,
        ...(item.dataset !== null ? { datasetId: item.dataset } : {}),
      });
    }
    return used.length ? { block: lines.join('\n'), used } : empty;
  }

  /** The dataset's tables; 404 when no dataset has that name. */
  private async requireDataset(name: string): Promise<string[]> {
    const [dataset] = await this.datasetsRepository.getByNames([name]);
    if (!dataset) throw new NotFoundException(`Dataset "${name}" not found`);
    return dataset.tables ?? [];
  }

  private async requireItem(id: string): Promise<OntologyItem> {
    const existing = await this.repository.get(id);
    if (!existing) throw new NotFoundException(`Ontology item ${id} not found`);
    return existing;
  }

  /**
   * Validate and normalize the fields of `kind` from `source` (on update the
   * stored fields merged with the patch, so cross-field rules see the whole
   * item); every field of another kind is dropped. Only the fields present
   * on `options.raw` are checked for emptiness on update.
   */
  private async kindFields(
    kind: OntologyKind,
    source: OntologyItemInput,
    options: {
      dataset: string | null;
      /** The dataset's tables; `null` for a shared item (any entity is accepted). */
      tables: string[] | null;
      isCreate: boolean;
      raw?: OntologyItemInput;
    },
  ): Promise<KindFields> {
    const { dataset, tables, isCreate } = options;
    // References (entities, concepts, metrics) are checked when created or
    // changed, so toggling an item never fails over a stored reference.
    const changed = (field: keyof OntologyItemInput) =>
      isCreate || options.raw?.[field] !== undefined;
    switch (kind) {
      case 'concept': {
        const synonyms = textList(source.synonyms);
        const mappings = parseMappings(source.mappings);
        if (dataset !== null && tables && changed('mappings')) {
          for (const mapping of mappings) {
            if (!tables.includes(mapping.entity)) {
              throw new BadRequestException(
                `Entity "${mapping.entity}" is not in dataset "${dataset}"`,
              );
            }
          }
        }
        return {
          ...(synonyms.length ? { synonyms } : {}),
          ...(mappings.length ? { mappings } : {}),
        };
      }
      case 'constraint': {
        const predicate = optionalText(source.predicate);
        if (!predicate) {
          throw new BadRequestException(
            isCreate ? 'predicate is required' : 'predicate must not be empty',
          );
        }
        const conceptId = optionalText(source.conceptId);
        if (conceptId && changed('conceptId')) {
          await this.requireConcept(conceptId, dataset);
        }
        const entities = textList(source.entities);
        return {
          predicate,
          ...(conceptId ? { conceptId } : {}),
          ...(entities.length ? { entities } : {}),
        };
      }
      case 'instruction': {
        const entities = textList(source.entities);
        return entities.length ? { entities } : {};
      }
      case 'relation': {
        const from = optionalText(source.from);
        if (!from) throw new BadRequestException('from is required');
        const type = RELATION_TYPES.find((t) => t === source.type);
        if (!type) {
          throw new BadRequestException(
            `type must be one of: ${RELATION_TYPES.join(', ')}`,
          );
        }
        if (changed('from')) await this.requireConcept(from, dataset);
        if (type === 'measured-by') {
          const metricId = optionalText(source.metricId);
          if (!metricId) {
            throw new BadRequestException(
              'metricId is required for measured-by',
            );
          }
          if (changed('metricId') || changed('type')) {
            const metrics = await this.metrics.list();
            if (!metrics.some((m) => m.id === metricId)) {
              throw new BadRequestException(`Metric "${metricId}" not found`);
            }
          }
          return { from, type, metricId };
        }
        const to = optionalText(source.to);
        if (!to) throw new BadRequestException('to is required');
        if (changed('to') || changed('type')) {
          await this.requireConcept(to, dataset);
        }
        return { from, type, to };
      }
    }
  }

  /** A concept of the item's own dataset, or a shared concept. */
  private async requireConcept(
    id: string,
    dataset: string | null,
  ): Promise<OntologyItem> {
    const concept = await this.repository.get(id);
    if (
      !concept ||
      concept.kind !== 'concept' ||
      (concept.dataset !== null && concept.dataset !== dataset)
    ) {
      throw new BadRequestException(`Concept "${id}" is not in this ontology`);
    }
    return concept;
  }

  /** `<from name> <type> <to name | metric label>`, the name of a relation created without one. */
  private async relationLabel(fields: KindFields): Promise<string> {
    const from = fields.from ? await this.repository.get(fields.from) : null;
    let target = '';
    if (fields.type === 'measured-by' && fields.metricId) {
      const metric = (await this.metrics.list()).find(
        (m) => m.id === fields.metricId,
      );
      target = metric?.label ?? fields.metricId;
    } else if (fields.to) {
      target = (await this.repository.get(fields.to))?.name ?? fields.to;
    }
    return [from?.name ?? fields.from ?? '', fields.type ?? '', target]
      .filter(Boolean)
      .join(' ');
  }
}

/** `400 kind must be one of: …` unless `value` names a kind. */
function parseKind(value: unknown): OntologyKind {
  const kind = ONTOLOGY_KINDS.find((k) => k === value);
  if (!kind) {
    throw new BadRequestException(
      `kind must be one of: ${ONTOLOGY_KINDS.join(', ')}`,
    );
  }
  return kind;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Trimmed strings, blanks dropped. */
function textList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function parseMappings(value: unknown): ConceptMapping[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('each mapping needs an entity');
  }
  return value.map((raw: unknown) => {
    const m = (raw && typeof raw === 'object' ? raw : {}) as Record<
      string,
      unknown
    >;
    const entity = optionalText(m.entity);
    if (!entity) throw new BadRequestException('each mapping needs an entity');
    const column = optionalText(m.column);
    const expression = optionalText(m.expression);
    return {
      entity,
      ...(column ? { column } : {}),
      ...(expression ? { expression } : {}),
    };
  });
}

/** The kind-specific fields of a stored item, as an input. */
function pickKindFields(item: OntologyItem): OntologyItemInput {
  return {
    synonyms: item.synonyms,
    mappings: item.mappings,
    predicate: item.predicate,
    conceptId: item.conceptId,
    entities: item.entities,
    from: item.from,
    type: item.type,
    to: item.to,
    metricId: item.metricId,
  };
}

/** `input` without its `undefined` keys, so a merge keeps the stored value. */
function definedOnly(input: OntologyItemInput): OntologyItemInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  );
}

/** `entity.column`, `expression`, or `expression (entity.column)`. */
function renderMapping(mapping: ConceptMapping): string {
  const ref = mapping.column ? `${mapping.entity}.${mapping.column}` : '';
  if (mapping.expression) {
    return ref ? `${mapping.expression} (${ref})` : mapping.expression;
  }
  return ref;
}

function entitiesSuffix(entities: string[] | undefined): string {
  return entities?.length ? `; entities: ${entities.join(', ')}` : '';
}

/**
 * One line per item, byte-identical to the old knowledge snippets for
 * migrated data. `null` for a relation whose endpoint no longer resolves.
 */
function renderItem(
  item: OntologyItem,
  concepts: Map<string, string>,
  metricLabels: Map<string, string>,
): { line: string; body: string } | null {
  const tag = KIND_TAG[item.kind];
  switch (item.kind) {
    case 'concept': {
      const synonyms = item.synonyms?.length
        ? `; synonyms: ${item.synonyms.join(', ')}`
        : '';
      const mappings = item.mappings ?? [];
      const entities = [...new Set(mappings.map((m) => m.entity))];
      const mapped = mappings.filter((m) => m.column || m.expression);
      const mapsTo = mapped.length
        ? `; maps to: ${mapped.map(renderMapping).join(', ')}`
        : '';
      return {
        line: `- [${tag}] ${item.name}: ${item.description}${synonyms}${entitiesSuffix(entities)}${mapsTo}`,
        body: item.description,
      };
    }
    case 'constraint': {
      const predicate = item.predicate ?? '';
      const when = item.description ? `; when: ${item.description}` : '';
      return {
        line: `- [${tag}] ${item.name}: ${predicate}${when}${entitiesSuffix(item.entities)}`,
        body: predicate,
      };
    }
    case 'instruction':
      return {
        line: `- [${tag}] ${item.name}: ${item.description}${entitiesSuffix(item.entities)}`,
        body: item.description,
      };
    case 'relation': {
      const from = item.from ? concepts.get(item.from) : undefined;
      const to =
        item.type === 'measured-by'
          ? item.metricId
            ? metricLabels.get(item.metricId)
            : undefined
          : item.to
            ? concepts.get(item.to)
            : undefined;
      if (from === undefined || to === undefined || !item.type) return null;
      const body = `${from} ${item.type} ${to}`;
      const description = item.description ? `: ${item.description}` : '';
      return { line: `- [${tag}] ${body}${description}`, body };
    }
  }
}
