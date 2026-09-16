import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
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
   */
  async definitionBlock(entities: string[]): Promise<string | undefined> {
    const metrics = await this.listForEntities(entities);
    if (!metrics.length) return undefined;
    const lines = [
      'Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):',
    ];
    let budget = METRICS_BLOCK_CHARS;
    for (const metric of metrics) {
      const dimensions = metric.dimensions?.length
        ? `; dimensions: ${metric.dimensions.join(', ')}`
        : '';
      const description = metric.description ? `; ${metric.description}` : '';
      const entry = `- ${metric.label} (${metric.name}) on ${metric.entity}: ${metric.expression}${dimensions}${description}`;
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
