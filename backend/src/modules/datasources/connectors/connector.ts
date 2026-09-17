import { BadRequestException } from '@nestjs/common';
import type {
  CatalogInfo,
  DatasourceConfig,
  QueryResult,
} from '../entities/datasource.entity';

/** A declared foreign key between two entities. Keys are `catalog.schema.table`. */
export interface ForeignKeyEdge {
  from: { entity: string; column: string };
  to: { entity: string; column: string };
}

/**
 * One implementation per datasource kind. Stateless: every call receives the
 * saved config, so a single connector serves any number of datasources.
 */
export interface DatasourceConnector<
  TConfig extends DatasourceConfig = DatasourceConfig,
> {
  testConnection(config: TConfig): Promise<void>;
  /** Everything the credentials can see, normalised to catalog → schema → table. */
  inventory(config: TConfig): Promise<CatalogInfo[]>;
  /** `SELECT * LIMIT n` over one `catalog.schema.table` entity. */
  sampleRows(
    config: TConfig,
    entity: string,
    limit: number,
  ): Promise<QueryResult>;
  /** Guarded read-only SQL in the datasource's dialect. */
  runReadOnlySql(
    config: TConfig,
    sql: string,
    rowLimit: number,
  ): Promise<QueryResult>;
  /**
   * Declared foreign keys among the given `catalog.schema.table` entities.
   * Optional: platforms that cannot report them simply omit it, and callers
   * fall back to inferring relationships from naming.
   */
  foreignKeys?(config: TConfig, entities: string[]): Promise<ForeignKeyEdge[]>;
  /** One-line description of where the datasource points (no secrets). */
  summary(config: TConfig): string;
  /** Same config with secret fields masked for API views. */
  mask(config: TConfig): TConfig;
}

/** Split a fully-qualified `catalog.schema.table` key. */
export function splitEntity(entity: string): [string, string, string] {
  const parts = (entity ?? '').split('.');
  if (parts.length !== 3 || parts.some((p) => !p.trim())) {
    throw new BadRequestException(
      `Entity must be catalog.schema.table — got "${entity}"`,
    );
  }
  return [parts[0].trim(), parts[1].trim(), parts[2].trim()];
}

export function clampRows(
  limit: number,
  fallback: number,
  max: number,
): number {
  return Math.max(1, Math.min(max, Math.floor(limit) || fallback));
}

// Read-only SQL guard, mirrored from data-readiness-agent's connector.
const FORBIDDEN_SQL =
  /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|upsert|replace)\b/i;

export function assertReadOnlySql(sql: string): string {
  const trimmed = (sql ?? '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!trimmed) throw new BadRequestException('Query is empty.');
  if (trimmed.includes(';')) {
    throw new BadRequestException('Only a single statement may be executed.');
  }
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new BadRequestException(
      'Only read-only SELECT / WITH queries can be run.',
    );
  }
  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new BadRequestException(
      'Query contains a forbidden (write/DDL) keyword.',
    );
  }
  return trimmed;
}

export const MASKED = '••••••••';
