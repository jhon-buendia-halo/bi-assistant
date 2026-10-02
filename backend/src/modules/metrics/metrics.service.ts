import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { DataModelsService } from '../data-models/data-models.service';
import { bindingAddress } from '../data-models/bootstrap';
import type {
  Metric,
  Predicate,
  PredicateOp,
} from '../data-models/entities/data-model.entity';
import { MetricsRepository } from './repositories/metrics.repository';
import type {
  MetricCandidate,
  MetricDoc,
  MetricInput,
} from './entities/metric.entity';

/** Character budget the governed-metrics system block may take per turn. */
const METRICS_BLOCK_CHARS = 4_000;
/** Prefilled drafts offered by the promotion path. */
const MAX_CANDIDATES = 12;
/** Slug rule for `name`: lowercase, starts with a letter, `_` separated. */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_CHARS = 64;

/**
 * Lightweight semantic layer: curated metric definitions the assistant must
 * reuse verbatim. App-managed on purpose — no dependency on Unity Catalog
 * Metric Views existing in the user's workspace.
 *
 * The `metrics` collection (`MetricsRepository`) is the *editor of record*
 * for this feature's public API and HTTP contract — every read/write here
 * goes straight through it, exactly as before ADR-0006 — until roadmap
 * 1.2.3 moves the panel onto the data model directly. What ADR-0006 adds is
 * a one-way mirror: every successful write calls `DataModelsService`'s
 * `syncMetric`/`removeMetric` so the metric also shows up (and stays
 * current) on every data model that binds its physical entity, which is
 * what the assistant and the Knowledge Store actually read from. The
 * mirror is fire-and-forget from this file's perspective — `DataModelsService`
 * never calls back in here, so there is no cycle.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly repository: MetricsRepository,
    private readonly verifiedQueries: VerifiedQueriesService,
    private readonly dataModels: DataModelsService,
  ) {}

  list(): Promise<MetricDoc[]> {
    return this.repository.list();
  }

  /** Metrics defined over any of these fully-qualified entities. */
  async listForEntities(entities: string[]): Promise<MetricDoc[]> {
    const scope = new Set(entities.map((entity) => entity.toLowerCase()));
    if (scope.size === 0) return [];
    const all = await this.repository.list();
    return all.filter((metric) => scope.has(metric.entity.toLowerCase()));
  }

  async create(input: MetricInput): Promise<MetricDoc> {
    const clean = await this.validate(input);
    const saved = await this.repository.insert({ id: randomUUID(), ...clean });
    await this.dataModels.syncMetric(saved);
    return saved;
  }

  async update(id: string, input: MetricInput): Promise<MetricDoc> {
    const existing = await this.repository.get(id);
    if (!existing) throw new BadRequestException(`Metric ${id} not found`);
    const clean = await this.validate(input, id);
    const optional: (keyof MetricDoc)[] = [
      'description',
      'dimensions',
      'datasourceId',
      'sourceVerifiedQueryId',
    ];
    const cleared = optional.filter((field) => !(field in clean));
    const saved = await this.repository.update(id, clean, cleared);
    if (!saved) throw new BadRequestException(`Metric ${id} not found`);
    // A renamed metric leaves a stale copy under its old name on every
    // model that had it — `syncMetric` only strips the *new* name, so the
    // old one needs its own pass first.
    if (existing.name !== saved.name) {
      await this.dataModels.removeMetric(existing.name);
    }
    await this.dataModels.syncMetric(saved);
    return saved;
  }

  async delete(id: string): Promise<MetricDoc> {
    const existing = await this.repository.get(id);
    if (!existing) throw new BadRequestException(`Metric ${id} not found`);
    await this.repository.delete(id);
    await this.dataModels.removeMetric(existing.name);
    return existing;
  }

  /**
   * Promotion path: verified question → SQL pairs, prefilled as metric drafts.
   * Pairs already promoted (and pairs with no entity provenance) drop out —
   * "already promoted" means the legacy `metrics` store has a copy sourced
   * from this verified query, OR (review finding 8) *any* current data
   * model does, regardless of which dataset's panel did the promoting; the
   * filter runs before the `MAX_CANDIDATES` slice so a promoted pair never
   * displaces a real candidate out of the page. The expression stays empty
   * — the user lifts the aggregation out of `sql`, we never guess it.
   */
  async candidates(entities?: string[]): Promise<MetricCandidate[]> {
    const [pairs, metrics, modelPromotedIds] = await Promise.all([
      this.verifiedQueries.list(),
      this.repository.list(),
      this.dataModels.promotedVerifiedQueryIds(),
    ]);
    const promoted = new Set([
      ...metrics
        .map((metric) => metric.sourceVerifiedQueryId)
        .filter((id): id is string => Boolean(id)),
      ...modelPromotedIds,
    ]);
    const scope = new Set((entities ?? []).map((e) => e.toLowerCase()));
    return pairs
      .filter((pair) => !promoted.has(pair.id) && pair.entities?.length)
      .map((pair) => ({
        verifiedQueryId: pair.id,
        name: toMetricName(pair.question),
        label: pair.question,
        entity: pair.entities[0],
        ...(pair.datasourceId ? { datasourceId: pair.datasourceId } : {}),
        sql: pair.sql,
      }))
      .filter(
        (candidate) =>
          scope.size === 0 || scope.has(candidate.entity.toLowerCase()),
      )
      .slice(0, MAX_CANDIDATES);
  }

  /**
   * roadmap 1.2.3 — the model-metrics panel's promotion path
   * (`GET /datasets/:name/model/metrics/candidates`): the same verified-query
   * drafts `candidates()` already offers (already filtered+sliced there, by
   * `sourceVerifiedQueryId` globally — review finding 8, so a rename after
   * promotion cannot un-exclude a pair), scoped to the dataset's bound
   * physical entities and re-addressed by the model's *logical* entity
   * names (`matches`, not `world_cup.world_cup.matches`) so the panel's
   * entity select can use them directly.
   */
  async candidatesForDataset(datasetName: string): Promise<MetricCandidate[]> {
    const doc = await this.dataModels.get(datasetName);
    if (!doc) return [];
    const current = doc.versions.find((v) => v.version === doc.currentVersion);
    if (!current) return [];

    const logicalNameByAddress = new Map<string, string>();
    for (const entity of current.model.entities) {
      const binding = entity.bindings[0];
      const address = binding ? bindingAddress(binding) : null;
      if (address) logicalNameByAddress.set(address.toLowerCase(), entity.name);
    }
    if (logicalNameByAddress.size === 0) return [];

    const legacy = await this.candidates(
      Array.from(logicalNameByAddress.keys()),
    );
    return legacy.map((candidate) => ({
      ...candidate,
      entity:
        logicalNameByAddress.get(candidate.entity.toLowerCase()) ??
        candidate.entity,
    }));
  }

  /**
   * The system block appended to the analysis prompt, or undefined when no
   * curated metric covers the entities in scope.
   *
   * roadmap 1.2.3 (review finding 1): reads governed metrics from the
   * *current data model* for any of `entities` a model binds — the model
   * is the panel's editor of record now, so a panel edit/delete must show
   * up here and a panel delete must not keep grounding through the stale
   * legacy copy. The legacy `metrics` store is only consulted for an
   * entity no model binds at all (pre-1.2.1 installs, or a table not yet
   * part of any dataset's model).
   */
  async definitionBlock(entities: string[]): Promise<string | undefined> {
    if (!entities.length) return undefined;
    const boundByModel = await this.dataModels.metricsBoundToEntities(entities);
    const legacyEntities = entities.filter(
      (entity) => !boundByModel.has(entity.toLowerCase()),
    );
    const legacyMetrics = legacyEntities.length
      ? await this.listForEntities(legacyEntities)
      : [];

    const entries: { entity: string; metric: Metric | MetricDoc }[] = [];
    for (const [entity, metrics] of boundByModel) {
      for (const metric of metrics) entries.push({ entity, metric });
    }
    for (const metric of legacyMetrics) {
      entries.push({ entity: metric.entity, metric });
    }
    if (!entries.length) return undefined;

    const lines = [
      'Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):',
    ];
    let budget = METRICS_BLOCK_CHARS;
    for (const { entity, metric } of entries) {
      const dimensions = metric.dimensions?.length
        ? `; dimensions: ${metric.dimensions.join(', ')}`
        : '';
      const description = metric.description ? `; ${metric.description}` : '';
      const expression = isModelMetric(metric)
        ? renderModelMetricExpression(metric)
        : metric.expression;
      const entry = `- ${metric.label} (${metric.name}) on ${entity}: ${expression}${dimensions}${description}`;
      if (entry.length > budget) break;
      budget -= entry.length;
      lines.push(entry);
    }
    return lines.length > 1 ? lines.join('\n') : undefined;
  }

  /**
   * Normalize and check a write. `selfId` is the metric being updated, so a
   * rename to its own name is not a duplicate.
   */
  private async validate(
    input: MetricInput,
    selfId?: string,
  ): Promise<MetricInput> {
    const name = (input?.name ?? '').trim().toLowerCase();
    const label = (input?.label ?? '').trim();
    const entity = (input?.entity ?? '').trim();
    const expression = (input?.expression ?? '').trim();
    if (!name) throw new BadRequestException('Metric name is required');
    if (name.length > MAX_NAME_CHARS) {
      throw new BadRequestException(
        `Metric name must be ${MAX_NAME_CHARS} characters or fewer`,
      );
    }
    if (!NAME_PATTERN.test(name)) {
      throw new BadRequestException(
        'Metric name must be lowercase letters, digits and underscores, starting with a letter (e.g. denial_rate)',
      );
    }
    if (!label) throw new BadRequestException('Metric label is required');
    if (!entity) throw new BadRequestException('Metric entity is required');
    if (!expression) {
      throw new BadRequestException('Metric expression is required');
    }
    // The expression is inlined into a generated statement — a semicolon would
    // let a definition chain a second statement onto a read-only query.
    if (expression.includes(';')) {
      throw new BadRequestException(
        'Metric expression must be a single SQL expression (no semicolons)',
      );
    }
    const clash = await this.repository.findByName(name);
    if (clash && clash.id !== selfId) {
      throw new BadRequestException(`Metric "${name}" already exists`);
    }
    const dimensions = (input?.dimensions ?? [])
      .map((dimension) => String(dimension).trim())
      .filter(Boolean);
    const description = (input?.description ?? '').trim();
    return {
      name,
      label,
      entity,
      expression,
      ...(description ? { description } : {}),
      ...(dimensions.length ? { dimensions } : {}),
      ...(input?.datasourceId ? { datasourceId: input.datasourceId } : {}),
      ...(input?.sourceVerifiedQueryId
        ? { sourceVerifiedQueryId: input.sourceVerifiedQueryId }
        : {}),
    };
  }
}

/** Slug a question into a metric handle: `Denial rate?` → `denial_rate`. */
export function toMetricName(question: string): string {
  const slug = (question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_NAME_CHARS)
    .replace(/_+$/, '');
  return NAME_PATTERN.test(slug) ? slug : '';
}

/** A model-sourced entry has `agg`/`expressions`, never a flat `expression`
 * string — the one shape difference `definitionBlock` needs to render it. */
function isModelMetric(metric: Metric | MetricDoc): metric is Metric {
  return !('expression' in metric);
}

/** `agg(of) [where …]` for the portable core, or `expressions.sql` verbatim
 * — the same two shapes `model-metrics-panel` offers, rendered as prompt
 * text the same way regardless of which one a metric used. */
function renderModelMetricExpression(metric: Metric): string {
  const base = metric.expressions?.sql
    ? metric.expressions.sql
    : renderAggregation(metric);
  const where = metric.where ? ` where ${renderPredicate(metric.where)}` : '';
  return `${base}${where}`;
}

function renderAggregation(metric: Metric): string {
  if (metric.agg === 'ratio') {
    return `${metric.numerator ?? '?'} / ${metric.denominator ?? '?'}`;
  }
  if (metric.agg === 'count') return 'count(*)';
  return `${metric.agg ?? 'agg'}(${metric.of ?? '?'})`;
}

const PREDICATE_OP_TEXT: Record<PredicateOp, string> = {
  eq: '=',
  ne: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'in',
  not_in: 'not in',
  between: 'between',
  is_null: 'is null',
  not_null: 'is not null',
  contains: 'contains',
  starts_with: 'starts with',
};

/** Readable text for a (possibly compound) predicate — good enough for a
 * prompt block, not a query compiler; `and`/`or`/`not` are rendered rather
 * than rejected since a YAML-authored metric can carry a tree the
 * model-metrics panel's single-condition builder never would. */
function renderPredicate(predicate: Predicate): string {
  if ('and' in predicate) {
    return predicate.and.map(renderPredicate).join(' and ');
  }
  if ('or' in predicate) {
    return `(${predicate.or.map(renderPredicate).join(' or ')})`;
  }
  if ('not' in predicate) {
    return `not (${renderPredicate(predicate.not)})`;
  }
  const opText = PREDICATE_OP_TEXT[predicate.op];
  if (predicate.op === 'is_null' || predicate.op === 'not_null') {
    return `${predicate.attr} ${opText}`;
  }
  return `${predicate.attr} ${opText} ${JSON.stringify(predicate.value)}`;
}
