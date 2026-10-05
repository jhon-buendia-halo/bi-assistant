import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import {
  entityKeysMatch,
  rankMetrics,
  tokenize,
} from '../knowledge/knowledge-ranking';
import { MetricsRepository } from './repositories/metrics.repository';
import type {
  MetricCandidate,
  MetricDoc,
  MetricInput,
} from './entities/metric.entity';

/** Character budget the governed-metrics system block may take per turn. */
const METRICS_BLOCK_CHARS = 4_000;
/** Max metrics `lookup` returns — a pull, not a dump. */
const LOOKUP_LIMIT = 8;
/** Prefilled drafts offered by the promotion path. */
const MAX_CANDIDATES = 12;
/** Slug rule for `name`: lowercase, starts with a letter, `_` separated. */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_NAME_CHARS = 64;

/**
 * Lightweight semantic layer: curated metric definitions the assistant must
 * reuse verbatim. App-managed on purpose — no dependency on Unity Catalog
 * Metric Views existing in the user's workspace.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly repository: MetricsRepository,
    private readonly verifiedQueries: VerifiedQueriesService,
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

  /**
   * Metrics matching `query`, ranked by relevance to `phrase` (and
   * `entity`) — the bridge behind the `lookup_knowledge`-style metric lookup
   * (L2 `lookupTools`, U1-F). `entities` scopes the candidate pool the same
   * way `listForEntities` does (empty = every metric); `query.entity`
   * further narrows via `entityKeysMatch` (exact or last-two-segment). At
   * most `LOOKUP_LIMIT` (8) results.
   */
  async lookup(
    entities: string[],
    query: { phrase?: string; entity?: string },
  ): Promise<
    {
      name: string;
      label?: string;
      entity: string;
      expression: string;
      description?: string;
    }[]
  > {
    const pool = entities.length
      ? await this.listForEntities(entities)
      : await this.repository.list();
    const filtered = query.entity
      ? pool.filter((metric) =>
          entityKeysMatch(metric.entity, query.entity as string),
        )
      : pool;
    const ranked = rankMetrics(filtered, {
      questionTokens: tokenize(query.phrase),
      entityNames: query.entity ? [query.entity] : entities,
    });
    return ranked.slice(0, LOOKUP_LIMIT).map((metric) => ({
      name: metric.name,
      label: metric.label,
      entity: metric.entity,
      expression: metric.expression,
      ...(metric.description ? { description: metric.description } : {}),
    }));
  }

  /** `{ entity, name, expression }` for every metric defined over `entities` — the shape `sql-precheck.ts` (U1-F) checks an aggregate's expression against. */
  async forEntities(
    entities: string[],
  ): Promise<{ entity: string; name: string; expression: string }[]> {
    const metrics = await this.listForEntities(entities);
    return metrics.map((metric) => ({
      entity: metric.entity,
      name: metric.name,
      expression: metric.expression,
    }));
  }

  async create(input: MetricInput): Promise<MetricDoc> {
    const clean = await this.validate(input);
    return this.repository.insert({ id: randomUUID(), ...clean });
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
    return saved;
  }

  async delete(id: string): Promise<MetricDoc> {
    const existing = await this.repository.get(id);
    if (!existing) throw new BadRequestException(`Metric ${id} not found`);
    await this.repository.delete(id);
    return existing;
  }

  /**
   * Promotion path: verified question → SQL pairs, prefilled as metric drafts.
   * Pairs already promoted (and pairs with no entity provenance) drop out. The
   * expression stays empty — the user lifts the aggregation out of `sql`, we
   * never guess it.
   */
  async candidates(entities?: string[]): Promise<MetricCandidate[]> {
    const [pairs, metrics] = await Promise.all([
      this.verifiedQueries.list(),
      this.repository.list(),
    ]);
    const promoted = new Set(
      metrics
        .map((metric) => metric.sourceVerifiedQueryId)
        .filter((id): id is string => Boolean(id)),
    );
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
   * The system block appended to the analysis prompt, or undefined when no
   * curated metric covers the entities in scope.
   *
   * `ranked` false/absent: byte-identical to the pre-L2 behaviour —
   * newest-defined-first, budget 4000, stop at the first metric that
   * doesn't fit. `ranked` true: metrics are scored against
   * `question`/`entities` (`knowledge-ranking.ts`'s `scoreMetric`) and the
   * budget (default `METRICS_BLOCK_CHARS`, override via `budgetChars`) is
   * filled best-first instead.
   */
  async definitionBlock(
    entities: string[],
    opts?: { question?: string; ranked?: boolean; budgetChars?: number },
  ): Promise<string | undefined> {
    const metrics = await this.listForEntities(entities);
    if (!metrics.length) return undefined;
    const ranked = opts?.ranked === true;
    const candidates = ranked
      ? rankMetrics(metrics, {
          questionTokens: tokenize(opts?.question),
          entityNames: entities,
        })
      : metrics;
    const lines = [
      'Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):',
    ];
    let budget = ranked
      ? (opts?.budgetChars ?? METRICS_BLOCK_CHARS)
      : METRICS_BLOCK_CHARS;
    for (const metric of candidates) {
      const dimensions = metric.dimensions?.length
        ? `; dimensions: ${metric.dimensions.join(', ')}`
        : '';
      const description = metric.description ? `; ${metric.description}` : '';
      const entry = `- ${metric.label} (${metric.name}) on ${metric.entity}: ${metric.expression}${dimensions}${description}`;
      if (entry.length > budget) {
        // See `KnowledgeService.contextFor` for why ranked mode keeps
        // trying (best-first fill) while the legacy path stops outright.
        if (!ranked) break;
        continue;
      }
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
