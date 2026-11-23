import type { Agent } from '@mastra/core/agent';
import { DASHBOARD_ROWS_CAP } from '../workflows/bi-dashboard.schemas';
import {
  DASHBOARD_TOOLS_RUNTIME_KEY,
  type DashboardToolsRuntime,
} from '../tools/dashboard.tools';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import { getDatasetToolServices } from '../tool-services';
import type * as BiAnalystAgent from '../agents/bi-analyst.agent';
import type { AssistantEvalSet, EvalTarget } from './assistant.evals';
import { EVAL_DETAILS_KEY } from './eval-details';
import { judgeSubmission, type BiAnalystRun } from './bi-analyst-eval-checks';

/**
 * The `bi-analyst` eval target (agents.md 8.1): each case runs Clara's turn
 * on the case's brief over the set's dataset, with her own dataset tools and
 * a `DashboardToolsRuntime` that answers `submit_dashboard` as the host does
 * (the 5,000-row limit and the binding check) and saves nothing. Her whole
 * submission record rides on the run details (`output`, a `BiAnalystRun`),
 * which `bi-analyst-eval-checks.ts` reads. Not an isolated call: she explores
 * with tools, so the target is her agent with `generate` wrapped.
 */

type Submission = Parameters<DashboardToolsRuntime['submit']>[0];
type RunSql = (
  datasourceId: string,
  sql: string,
  limit: number,
  datasets: string[],
) => Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;

/**
 * The eval's runtime: runs her query on the datasets (one row past the cap,
 * so an over-long result is seen), judges it as the host does, and records
 * what happened on `run`.
 */
export function evalDashboardRuntime(
  datasets: string[],
  run: BiAnalystRun,
  runSql: RunSql = (...args) =>
    getDatasetToolServices().runReadOnlySql(...args),
): DashboardToolsRuntime {
  return {
    async submit(input: Submission) {
      run.submissions += 1;
      let verdict: ReturnType<typeof judgeSubmission>;
      try {
        const result = await runSql(
          input.datasourceId,
          input.sql,
          DASHBOARD_ROWS_CAP + 1,
          datasets,
        );
        verdict = judgeSubmission(input.dashboard, result);
      } catch (err) {
        verdict = {
          accepted: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (!verdict.accepted) {
        run.refusals.push(verdict.error);
        return verdict;
      }
      run.accepted = {
        draft: input.dashboard,
        sql: input.sql,
        rowCount: verdict.rowCount,
        columns: verdict.columns,
      };
      return verdict;
    },
  };
}

type GenerateOptions = {
  requestContext?: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
};

/**
 * Clara's agent with `generate` replaced by her turn: a fresh run record and
 * runtime on the case's requestContext, then her own `generate`, whose
 * result carries the record as run details. Every other member is hers.
 */
export function biAnalystTurnAgent(
  agent: Agent,
  runtimeOf: (datasets: string[], run: BiAnalystRun) => DashboardToolsRuntime,
): Agent {
  const generate = async (input: unknown, options?: GenerateOptions) => {
    const run: BiAnalystRun = { submissions: 0, refusals: [] };
    const requestContext = options?.requestContext;
    const datasets = (requestContext?.get(DATASETS_CONTEXT_KEY) ??
      []) as string[];
    requestContext?.set(DASHBOARD_TOOLS_RUNTIME_KEY, runtimeOf(datasets, run));
    const generateTurn = agent.generate.bind(agent) as unknown as (
      input: unknown,
      options?: unknown,
    ) => Promise<object>;
    const result: object = await generateTurn(input, options);
    return Object.assign(result, { [EVAL_DETAILS_KEY]: { output: run } });
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

/** Clara's target; her agent loads on first use. */
export function biAnalystEvalTarget(
  sets: AssistantEvalSet[],
  loadAgent: () => Agent = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../agents/bi-analyst.agent') as typeof BiAnalystAgent)
      .biAnalystAgent,
  runtimeOf: (
    datasets: string[],
    run: BiAnalystRun,
  ) => DashboardToolsRuntime = (datasets, run) =>
    evalDashboardRuntime(datasets, run),
): EvalTarget {
  let agent: Agent | undefined;
  let turn: Agent | undefined;
  return {
    agentKey: 'bi-analyst',
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      turn ??= biAnalystTurnAgent((agent ??= loadAgent()), runtimeOf);
      return turn;
    },
    sets,
    // Her prompt and tools are her whole context: no orientation block, no
    // curated knowledge. She explores with list_entities and describe_entity.
    orientation: () => '',
    sendsKnowledge: false,
  };
}
