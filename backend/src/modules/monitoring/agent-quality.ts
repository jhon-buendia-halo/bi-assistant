import type { EvalRunView } from '../agents/eval-runs.service';
import type {
  AgentQualityPage,
  AgentQualityRow,
} from './entities/agent-quality.entity';
import { estimateCostUsd } from './model-prices';
import { percentile } from './usage-summary';
import { num } from './span-values';

/** Injection token of the catalogue of agents with eval sets. */
export const AGENT_QUALITY_CATALOGUE = 'AGENT_QUALITY_CATALOGUE';

/** The model of a run that recorded none (monitoring R61). */
export const UNKNOWN_MODEL = 'Unknown';

/** One built-in agent with eval sets, as plain data. */
export interface QualityAgent {
  /** Registry key (`eval_runs.agentKey`). */
  key: string;
  /** Mastra agent id (span `entityId`). */
  agentId: string;
  name: string;
  role: string;
  sets: { id: string; name: string; caseIds: string[] }[];
}

/** One live model call (a `model_generation` outside eval runs). */
export interface LiveCall {
  agentId: string | null;
  startedAt: Date | string;
  endedAt: Date | string | null;
  status: string;
  model: string;
  inputTokens: unknown;
  outputTokens: unknown;
  cacheReadTokens: unknown;
  cacheWriteTokens: unknown;
}

export interface QualityFilter {
  agent?: string;
  set?: string;
  model?: string;
  from: Date | null;
  to: Date;
}

export interface QualityInput {
  agents: QualityAgent[];
  /** Every run of each agent, by registry key; any status. */
  runs: Map<string, EvalRunView[]>;
  /** The live calls in scope (agent ids, period and model already applied). */
  liveCalls: LiveCall[];
  /** Distinct live call models of the agents' ids (never filtered). */
  liveModels: string[];
  filter: QualityFilter;
}

/** A completed run with its set, model and provider read as monitoring R61. */
export interface NormalisedRun {
  run: EvalRunView;
  setId: string | null;
  model: string;
  provider: string | null;
  /** `finishedAt`, else `startedAt`. */
  at: Date;
}

/**
 * The completed runs of one agent, set derived for old runs (the single set
 * whose cases hold every one of the run's `caseIds`), model `Unknown` and
 * provider null when not stored, newest first.
 */
export function normaliseRuns(
  agent: QualityAgent,
  runs: EvalRunView[],
): NormalisedRun[] {
  const out: NormalisedRun[] = [];
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    let setId: string | null;
    if (run.setId !== undefined) {
      setId = run.setId;
    } else {
      const wanted = run.caseIds ?? [];
      const holders = agent.sets.filter(
        (set) =>
          wanted.length > 0 && wanted.every((id) => set.caseIds.includes(id)),
      );
      setId = holders.length === 1 ? holders[0].id : null;
    }
    const at = new Date(run.finishedAt ?? run.startedAt);
    out.push({
      run,
      setId,
      model: run.model ? run.model : UNKNOWN_MODEL,
      provider: run.provider ?? null,
      at: Number.isNaN(at.getTime()) ? new Date(0) : at,
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function inScope(run: NormalisedRun, filter: QualityFilter): boolean {
  if (filter.set !== undefined && run.setId !== filter.set) return false;
  if (filter.from && run.at < filter.from) return false;
  if (run.at > filter.to) return false;
  if (filter.model !== undefined && run.model !== filter.model) return false;
  return true;
}

type Pass3 = NonNullable<AgentQualityRow['eval']['pass3']>;

/** pass^3: the share of questions that passed in each of their last 3 runs. */
export function passCubed(
  agent: QualityAgent,
  runs: NormalisedRun[],
  model: string,
  set: string | undefined,
): Pass3 {
  if (model === UNKNOWN_MODEL) return { state: 'unknown-model' };
  const current = new Set(
    agent.sets
      .filter((s) => set === undefined || s.id === set)
      .flatMap((s) => s.caseIds),
  );
  const perCase = new Map<string, boolean[]>();
  for (const { run } of runs) {
    for (const result of run.results) {
      if (!current.has(result.id)) continue;
      const list = perCase.get(result.id) ?? [];
      list.push(result.passed === true);
      perCase.set(result.id, list);
    }
  }
  let eligible = 0;
  let allPassed = 0;
  let most = 0;
  for (const list of perCase.values()) {
    most = Math.max(most, Math.min(list.length, 2));
    if (list.length < 3) continue;
    eligible += 1;
    if (list.slice(0, 3).every(Boolean)) allPassed += 1;
  }
  if (eligible === 0) {
    return { state: 'needs-runs', runs: most as 0 | 1 | 2 };
  }
  return {
    state: 'ok',
    value: allPassed / eligible,
    cases: eligible,
    totalCases: perCase.size,
  };
}

const NO_EVAL: AgentQualityRow['eval'] = {
  state: 'none',
  model: null,
  provider: null,
  runs: 0,
  lastRun: null,
  pass3: null,
  questions: 0,
  toolCalls: 0,
  toolCallsPerQuestion: null,
  toolErrorRate: null,
};

/** The eval half of a row (monitoring R61-R64). */
export function evalFigures(
  agent: QualityAgent,
  all: EvalRunView[],
  filter: QualityFilter,
): AgentQualityRow['eval'] {
  const completed = normaliseRuns(agent, all);
  if (completed.length === 0) return { ...NO_EVAL };
  const scoped = completed.filter((run) => inScope(run, filter));
  const model = filter.model ?? scoped[0]?.model;
  const onModel = scoped.filter((run) => run.model === model);
  if (model === undefined || onModel.length === 0) {
    return { ...NO_EVAL, state: 'no-match' };
  }
  const last = onModel[0];
  const results = onModel.flatMap(({ run }) => run.results);
  const calls = results.flatMap((result) => result.toolCalls ?? []);
  const failed = calls.filter((call) => !!call.error).length;
  return {
    state: 'ok',
    model,
    provider: last.provider,
    runs: onModel.length,
    lastRun: {
      jobId: last.run.jobId,
      at: last.at.toISOString(),
      passed: last.run.results.filter((r) => r.passed).length,
      total: last.run.results.length,
    },
    pass3: passCubed(agent, onModel, model, filter.set),
    questions: results.length,
    toolCalls: calls.length,
    toolCallsPerQuestion:
      results.length === 0 ? null : calls.length / results.length,
    toolErrorRate: calls.length === 0 ? null : failed / calls.length,
  };
}

/** The live half of a row (monitoring R65). */
export function liveFigures(calls: LiveCall[]): AgentQualityRow['live'] {
  const durations: number[] = [];
  let cost = 0;
  let priced = 0;
  for (const call of calls) {
    if (call.status !== 'running' && call.endedAt) {
      const ms =
        new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
      if (Number.isFinite(ms)) durations.push(ms);
    }
    const estimate = estimateCostUsd(call.model, {
      inputTokens: num(call.inputTokens),
      outputTokens: num(call.outputTokens),
      cacheReadTokens: num(call.cacheReadTokens),
      cacheWriteTokens: num(call.cacheWriteTokens),
    });
    if (estimate !== null) {
      cost += estimate;
      priced += 1;
    }
  }
  durations.sort((a, b) => a - b);
  return {
    calls: calls.length,
    p95Ms: durations.length === 0 ? null : percentile(durations, 0.95),
    pricedCalls: priced,
    costPerCallUsd: priced === 0 ? null : cost / priced,
  };
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

/** The whole page. */
export function buildAgentQualityPage(input: QualityInput): AgentQualityPage {
  const { agents, runs, liveCalls, filter } = input;
  const sorted = [...agents].sort((a, b) => byName(a.name, b.name));

  const setOwner = filter.set
    ? sorted.find((a) => a.sets.some((s) => s.id === filter.set))
    : undefined;
  const shown = sorted.filter((agent) => {
    if (filter.agent !== undefined && agent.key !== filter.agent) return false;
    if (filter.set !== undefined && setOwner?.key !== agent.key) return false;
    return true;
  });

  const rows: AgentQualityRow[] = shown.map((agent) => ({
    agentKey: agent.key,
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
    eval: evalFigures(agent, runs.get(agent.key) ?? [], filter),
    live: liveFigures(liveCalls.filter((c) => c.agentId === agent.agentId)),
  }));

  const models = new Set<string>(input.liveModels.filter((m) => m !== ''));
  let unknown = false;
  for (const agent of sorted) {
    for (const run of normaliseRuns(agent, runs.get(agent.key) ?? [])) {
      if (run.model === UNKNOWN_MODEL) unknown = true;
      else models.add(run.model);
    }
  }
  const facetModels = [...models].sort(byName);
  if (unknown) facetModels.push(UNKNOWN_MODEL);

  return {
    from: filter.from ? filter.from.toISOString() : null,
    to: filter.to.toISOString(),
    rows,
    facets: {
      agents: sorted.map((a) => ({ key: a.key, name: a.name })),
      sets: sorted.flatMap((a) =>
        [...a.sets]
          .sort((x, y) => byName(x.name, y.name))
          .map((s) => ({ id: s.id, name: s.name, agentKey: a.key })),
      ),
      models: facetModels,
    },
  };
}
