import type { Agent } from '@mastra/core/agent';
import type { ChatMessage } from '../../modules/sessions/entities/session.entity';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import { evidenceOf } from '../../modules/sessions/query-evidence/query-evidence';
import type { QueryEvidenceService } from '../../modules/sessions/query-evidence/query-evidence.service';
import type {
  QueryEvidence,
  QueryExplanation,
} from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  checkStageCounts,
  foreignTable,
} from '../agents/query-explainer.prompts';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { lastUserText } from './insights-analyst-workflow-target';

/**
 * The `query-explainer` eval target's turn (agents.md 8.1, 2.12): a case is
 * one statement, and a run of it does what the app does when a query is
 * opened in the query inspector: size the tables the statement reads
 * (`QueryEvidenceService.prepare`), ask the explainer once, then count each
 * step on the real data through the read-only guard and let
 * `checkStageCounts` decide. The scored answer is the explanation as JSON
 * text, with its `stageCounts`, so the checks and the judge read one thing.
 */

/**
 * The parts of `QueryEvidenceService` a run uses. The service is installed
 * at boot (`QueryExplainerEvalBridge`), as the tools' services are: the eval
 * sets are built before any Nest provider exists.
 */
export type ExplainerEvalServices = Pick<
  QueryEvidenceService,
  'datasourceFor' | 'rerun' | 'prepare' | 'countRows'
>;

let installed: ExplainerEvalServices | undefined;

export function installQueryExplainerEvalServices(
  services: ExplainerEvalServices | undefined,
): void {
  installed = services;
}

export function queryExplainerEvalServices(): ExplainerEvalServices {
  if (!installed) {
    throw new Error(
      'The query explainer evals need the query evidence service, which the app installs at start-up',
    );
  }
  return installed;
}

/** The model call: `explainQueryWithModel`, or a stand-in. */
export type ExplainQuery = (input: {
  record: ToolDataRecord;
  evidence: QueryEvidence;
}) => Promise<QueryExplanation>;

/** The rows the evidence of an eval statement is read from (the tool's cap). */
const EVAL_ROW_LIMIT = 100;

/**
 * One statement explained as the app does: run it for its rows, size its
 * tables, ask the explainer, count the steps. A statement that does not run
 * throws (the case fails with its message); a count that cannot be made or
 * does not verify is `stageCounts.status: 'unverified'` with its reason, as
 * `countQuerySteps` stores it.
 */
export async function explainForEval(input: {
  sql: string;
  rationale?: string;
  datasets: string[];
  services: ExplainerEvalServices;
  explain: ExplainQuery;
}): Promise<QueryExplanation> {
  const { sql, datasets, services } = input;
  const statement: ToolDataRecord = {
    tool: 'run_readonly_sql',
    input: sql,
    ...(input.rationale ? { rationale: input.rationale } : {}),
  };
  const source = await services.datasourceFor(undefined, datasets);
  const ran = await services.rerun(
    statement,
    { index: 0, rowLimit: EVAL_ROW_LIMIT },
    datasets,
  );
  const record: ToolDataRecord = {
    ...statement,
    columns: ran.columns,
    rows: ran.rows,
    rowCount: ran.rowCount,
    ...(ran.totalRows !== undefined && ran.totalRows > ran.rowCount
      ? { truncated: true }
      : {}),
  };
  const built = evidenceOf([record], () => ({
    datasourceId: source.id,
    rowLimit: EVAL_ROW_LIMIT,
    ...(ran.totalRows !== undefined ? { totalRows: ran.totalRows } : {}),
  }));
  const prepared = await services.prepare(
    { data: [record], evidence: built } as unknown as ChatMessage,
    datasets,
  );
  const entry = (prepared ?? built)[0];
  const explanation = await input.explain({ record, evidence: entry });
  return countSteps(explanation, record, entry, source.id, services);
}

/** The step counts on the real data (api.md 141, as `countQuerySteps` does). */
async function countSteps(
  explanation: QueryExplanation,
  record: ToolDataRecord,
  entry: QueryEvidence,
  datasourceId: string,
  services: ExplainerEvalServices,
): Promise<QueryExplanation> {
  const unverified = (reason: string): QueryExplanation => ({
    ...explanation,
    stageCounts: {
      status: 'unverified',
      at: new Date().toISOString(),
      reason,
    },
  });
  const steps = explanation.steps.filter((s) => s.verb !== 'show');
  const tables = entry.tables ?? [];
  if (!tables.length) {
    return unverified('The tables the query reads are not known');
  }
  const entities = tables.map((t) => t.entity);
  for (const [i, step] of steps.entries()) {
    if (!step.countSql) {
      return unverified(`Step ${i + 1} (${step.verb}) has no count statement`);
    }
    const foreign = foreignTable(step.countSql, entities);
    if (foreign) {
      return unverified(
        `Step ${i + 1} (${step.verb}) reads ${foreign}, which the query does not read`,
      );
    }
  }
  const counts: number[] = [];
  for (const [i, step] of steps.entries()) {
    try {
      counts.push(
        await services.countRows(datasourceId, step.countSql as string),
      );
    } catch (error) {
      return unverified(
        `Step ${i + 1} (${step.verb}) could not be counted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const check = checkStageCounts({
    steps,
    counts,
    tables,
    outerLimit: entry.outerLimit,
    totalRows: entry.totalRows,
    rowCount: record.rowCount ?? record.rows?.length ?? 0,
    truncated: record.truncated,
  });
  if (check.status === 'unverified') return unverified(check.reason);
  let next = 0;
  return {
    ...explanation,
    steps: explanation.steps.map((s) =>
      s.verb === 'show' ? s : { ...s, rows: counts[next++] },
    ),
    stageCounts: { status: 'verified', at: new Date().toISOString() },
  };
}

/** What `runEvals` reads of a target's result without any tool call. */
function answerResult(input: unknown, answer: string) {
  return {
    text: answer,
    steps: [],
    toolCalls: [],
    toolResults: [],
    scoringData: { input, output: [] },
  };
}

type GenerateOptions = {
  requestContext?: { get(key: string): unknown };
};

/**
 * The explainer agent, its `generate` replaced by one explained statement
 * (above). The question the case sends is the statement; its rationale comes
 * from `rationaleOf`. Every other member is the agent's own.
 */
export function explainerTurnAgent(
  agent: Agent,
  explain: ExplainQuery,
  rationaleOf: (sql: string) => string | undefined,
  services: () => ExplainerEvalServices = queryExplainerEvalServices,
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const datasets = options.requestContext?.get(DATASETS_CONTEXT_KEY);
    const sql = lastUserText(input).trim();
    const explanation = await explainForEval({
      sql,
      rationale: rationaleOf(sql),
      datasets: Array.isArray(datasets) ? (datasets as string[]) : [],
      services: services(),
      explain,
    });
    return answerResult(input, JSON.stringify(explanation));
  };
  return new Proxy(agent, {
    get(target, property): unknown {
      if (property === 'generate') return generate;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
