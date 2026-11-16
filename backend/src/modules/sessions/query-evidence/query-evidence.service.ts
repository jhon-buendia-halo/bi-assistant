import { BadRequestException, Injectable } from '@nestjs/common';
import { DatasetsRepository } from '../../datasets/repositories/datasets.repository';
import { mapWithConcurrency } from '../../datasources/connectors/connector';
import type {
  PageRequest,
  PageResult,
} from '../../datasources/connectors/paged-sql.types';
import { DatasourcesService } from '../../datasources/datasources.service';
import type { DatasourceKind } from '../../datasources/entities/datasource.entity';
import type { ChatMessage, ToolDataRecord } from '../entities/session.entity';
import { SessionDatasets } from '../turn/session-datasets';
import { EXPORT_ROWS, coverageOf, withExportLimit } from './query-coverage';
import { evidenceOf } from './query-evidence';
import type {
  QueryCoverage,
  QueryEvidence,
  QueryTableSize,
} from './query-evidence.types';
import { countStatement, tablesOfQuery } from './query-tables';
import { pageResultOf, preparePage, type PageSource } from './result-view';

/** Table counts in flight at once (api.md 139). */
export const TABLE_COUNT_CONCURRENCY = 3;
/** The tool defaults, for a record stored before its cap was recorded. */
const SQL_DEFAULT_LIMIT = 100;
const SAMPLE_DEFAULT_LIMIT = 10;

/** What a re-run answers (api.md 142); mirrors the frontend's `QueryRerunResult`. */
export interface QueryRerunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalRows?: number;
  coverage: QueryCoverage;
  ranAt: string;
}

/** The rows of a CSV download (api.md 143). */
export interface QueryExport {
  columns: string[];
  rows: Record<string, unknown>[];
  /** More than `EXPORT_ROWS` rows existed: `X-Rows-Cut`. */
  cut: boolean;
}

interface BoundDataset {
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  tables: string[];
}

export interface QueryDatasource {
  id: string;
  kind: DatasourceKind;
}

/** An integer count from the first cell of a one-row result, else null. */
function countOf(rows: Record<string, unknown>[]): number | null {
  const first = rows[0];
  if (!first) return null;
  const value = Object.values(first)[0];
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
          ? Number(value)
          : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The query inspector's backend (plan docs/plans/m1-25-query-inspector.md
 * 1.25.1, 3d, 3e): evidence for answers stored before it, table sizes,
 * re-runs and exports. Every statement goes through
 * `DatasourcesService.runReadOnlySql` directly (the connector's guard and
 * PostgreSQL's READ ONLY transaction apply), with no repair: a re-run must
 * execute the same statement. Nothing here writes; the caller stores.
 */
@Injectable()
export class QueryEvidenceService {
  private readonly bound: SessionDatasets;

  constructor(
    datasetsRepository: DatasetsRepository,
    private readonly datasources: DatasourcesService,
  ) {
    this.bound = new SessionDatasets(datasetsRepository, datasources);
  }

  /**
   * The answer's evidence with what is missing filled (api.md 139): built
   * from `data` when the answer predates it, then `datasourceKind` and the
   * size of each table read, one `SELECT COUNT(*)` per distinct table, at
   * most 3 at a time. A count that fails gives `rows: null` and its error.
   * Null when nothing was missing: no query ran and there is nothing to store.
   */
  async prepare(
    answer: ChatMessage,
    datasetNames: string[],
  ): Promise<QueryEvidence[] | null> {
    const data = answer.data ?? [];
    const built = !answer.evidence;
    const evidence = (answer.evidence ?? evidenceOf(data)).map((e) => ({
      ...e,
    }));
    const pending = evidence.filter((entry) => {
      const record = data[entry.index];
      return (
        record &&
        !record.error &&
        (entry.datasourceKind === undefined || entry.tables === undefined)
      );
    });
    if (!pending.length) return built ? evidence : null;

    const datasets = await this.datasets(datasetNames);
    const counts = new Map<
      string,
      { datasourceId: string; kind: DatasourceKind; entity: string }
    >();
    const planned = new Map<QueryEvidence, string[]>();
    for (const entry of pending) {
      const record = data[entry.index];
      let source: QueryDatasource;
      try {
        source = await this.resolve(entry, datasets);
      } catch (error) {
        // The table names are still known; their size is not.
        const reason = message(error);
        entry.tables ??= this.tablesOf(record, datasets, undefined).map(
          (entity): QueryTableSize => ({ entity, rows: null, error: reason }),
        );
        continue;
      }
      entry.datasourceId ??= source.id;
      entry.datasourceKind ??= source.kind;
      if (entry.tables !== undefined) continue;
      const tables = this.tablesOf(
        record,
        datasets.filter((d) => d.datasourceId === source.id),
        source.kind,
      );
      planned.set(entry, tables);
      for (const entity of tables) {
        counts.set(`${source.id}\u0000${entity}`, {
          datasourceId: source.id,
          kind: source.kind,
          entity,
        });
      }
    }

    const sizes = new Map<string, QueryTableSize>();
    await mapWithConcurrency(
      Array.from(counts.entries()),
      TABLE_COUNT_CONCURRENCY,
      async ([key, table]) => {
        try {
          const rows = await this.countRows(
            table.datasourceId,
            countStatement(table.entity, table.kind),
          );
          sizes.set(key, { entity: table.entity, rows });
        } catch (error) {
          sizes.set(key, {
            entity: table.entity,
            rows: null,
            error: message(error),
          });
        }
      },
    );
    for (const [entry, tables] of planned) {
      entry.tables = tables.map(
        (entity) =>
          sizes.get(`${entry.datasourceId}\u0000${entity}`) ?? {
            entity,
            rows: null,
          },
      );
    }
    // A datasource that still cannot be resolved changes nothing to store.
    return !built &&
      JSON.stringify(evidence) === JSON.stringify(answer.evidence)
      ? null
      : evidence;
  }

  /**
   * The datasource one query runs on (plan 3e): its recorded
   * `datasourceId` when the run's datasets use it, else the run's only
   * datasource. 400 when there are several, or none.
   */
  async datasourceFor(
    evidence: Pick<QueryEvidence, 'datasourceId'> | undefined,
    datasetNames: string[],
  ): Promise<QueryDatasource> {
    return this.resolve(evidence, await this.datasets(datasetNames));
  }

  /**
   * Run one stored query again (api.md 142), at its `rowLimit`, with no
   * repair. Nothing is stored. The connector's error is a 400.
   */
  async rerun(
    record: ToolDataRecord,
    evidence: QueryEvidence | undefined,
    datasetNames: string[],
  ): Promise<QueryRerunResult> {
    const source = await this.datasourceFor(evidence, datasetNames);
    const sample = record.tool === 'sample_rows';
    const rowLimit =
      evidence?.rowLimit ?? (sample ? SAMPLE_DEFAULT_LIMIT : SQL_DEFAULT_LIMIT);
    const result = await this.guarded(() =>
      sample
        ? this.datasources.sampleRows(source.id, record.input ?? '', rowLimit)
        : this.datasources.runReadOnlySql(
            source.id,
            record.input ?? '',
            rowLimit,
          ),
    );
    const rows = result.rows ?? [];
    const totalRows = sample ? undefined : result.totalRows;
    return {
      columns: result.columns?.length
        ? result.columns
        : Object.keys(rows[0] ?? {}),
      rows,
      rowCount: rows.length,
      ...(typeof totalRows === 'number' ? { totalRows } : {}),
      coverage: coverageOf({
        tool: record.tool,
        sql: record.input,
        rowCount: rows.length,
        totalRows,
        rowLimit,
      }),
      ranAt: new Date().toISOString(),
    };
  }

  /**
   * Every row of one stored query, up to `EXPORT_ROWS` (api.md 143): its
   * top-level LIMIT raised to 50,001 (or appended), 50,000 kept. A sample
   * is taken again at its own size.
   */
  async exportRows(
    record: ToolDataRecord,
    evidence: QueryEvidence | undefined,
    datasetNames: string[],
  ): Promise<QueryExport> {
    if (record.tool === 'sample_rows') {
      const { columns, rows } = await this.rerun(
        record,
        evidence,
        datasetNames,
      );
      return { columns, rows, cut: false };
    }
    const source = await this.datasourceFor(evidence, datasetNames);
    const fetched = EXPORT_ROWS + 1;
    const result = await this.guarded(() =>
      this.datasources.runReadOnlySql(
        source.id,
        withExportLimit(record.input ?? ''),
        fetched,
        fetched,
      ),
    );
    const rows = result.rows ?? [];
    return {
      columns: result.columns?.length
        ? result.columns
        : Object.keys(rows[0] ?? {}),
      rows: rows.slice(0, EXPORT_ROWS),
      cut: rows.length > EXPORT_ROWS || (result.totalRows ?? 0) > EXPORT_ROWS,
    };
  }

  /**
   * One page of a stored query's full result (api.md 152, 154): the stored
   * SQL (the corrected one, for a repaired query) over its stored columns,
   * filtered, sorted and paged by the connector under its datasource's
   * timeout. The request is checked before any query; a sample has no full
   * result to page. Nothing is stored.
   */
  async page(
    record: ToolDataRecord,
    evidence: QueryEvidence,
    datasetNames: string[],
    request: PageRequest,
  ): Promise<PageResult> {
    if (record.tool === 'sample_rows') {
      throw new BadRequestException(
        `Query ${evidence.index} is a sample; it has no full result to page`,
      );
    }
    const { result } = await this.pageRun(
      {
        sql: record.input ?? '',
        columns: record.columns,
        rows: record.rows,
        datasourceId: evidence.datasourceId,
      },
      datasetNames,
      request,
    );
    return result;
  }

  /**
   * One page of a query known by its SQL, columns and kinds (api.md 152,
   * 154; the `explore_result` tool, agents.md 3.15): the same checks, caps
   * and datasource choice as `page`, and the datasource it ran on. Nothing
   * is stored.
   */
  async pageOf(
    source: PageSource & { datasourceId?: string },
    datasetNames: string[],
    request: PageRequest,
  ): Promise<PageResult & { datasourceId: string }> {
    const { result, datasourceId } = await this.pageRun(
      source,
      datasetNames,
      request,
    );
    return { ...result, datasourceId };
  }

  private async pageRun(
    source: PageSource & { datasourceId?: string },
    datasetNames: string[],
    request: PageRequest,
  ): Promise<{ result: PageResult; datasourceId: string }> {
    const prepared = preparePage(source, request);
    const datasource = await this.datasourceFor(
      { datasourceId: source.datasourceId },
      datasetNames,
    );
    const paged = await this.guarded(() =>
      this.datasources.runPagedSql(datasource.id, prepared.statement),
    );
    return {
      result: pageResultOf(prepared, paged),
      datasourceId: datasource.id,
    };
  }

  /**
   * One count statement's result (table sizes here, the step counts of
   * 1.25.3): a single integer of 0 or more, else it throws.
   */
  async countRows(datasourceId: string, sql: string): Promise<number> {
    const result = await this.datasources.runReadOnlySql(datasourceId, sql, 1);
    const n = countOf(result.rows ?? []);
    if (n === null) {
      throw new Error('The count did not return one whole number');
    }
    return n;
  }

  private async datasets(names: string[]): Promise<BoundDataset[]> {
    return await this.bound.bound(names);
  }

  private async resolve(
    evidence: Pick<QueryEvidence, 'datasourceId'> | undefined,
    datasets: BoundDataset[],
  ): Promise<QueryDatasource> {
    const kinds = new Map<string, DatasourceKind | undefined>();
    for (const dataset of datasets) {
      if (dataset.datasourceId) {
        kinds.set(dataset.datasourceId, dataset.datasourceKind);
      }
    }
    let id: string;
    if (evidence?.datasourceId && kinds.has(evidence.datasourceId)) {
      id = evidence.datasourceId;
    } else if (kinds.size === 1) {
      id = Array.from(kinds.keys())[0];
    } else if (kinds.size === 0) {
      throw new BadRequestException(
        "No datasource is bound to this run's datasets",
      );
    } else {
      throw new BadRequestException(
        'Several datasources are in scope for this run; this query cannot be re-run',
      );
    }
    const kind = kinds.get(id) ?? (await this.datasources.get(id)).kind;
    return { id, kind };
  }

  /** The catalog entities one record reads. */
  private tablesOf(
    record: ToolDataRecord,
    datasets: BoundDataset[],
    kind: DatasourceKind | undefined,
  ): string[] {
    const entities = Array.from(new Set(datasets.flatMap((d) => d.tables)));
    if (record.tool === 'sample_rows') {
      const key = (record.input ?? '').toLowerCase();
      return entities.filter((e) => e.toLowerCase() === key);
    }
    return tablesOfQuery(record.input ?? '', entities, kind);
  }

  /** A connector failure answers 400 with its own message (api.md 142). */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(message(error));
    }
  }
}
