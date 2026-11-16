import {
  ASSISTANT_EVAL_SETS,
  ASSISTANT_EVAL_TARGET,
  type AssistantEvalSet,
  type EvalTarget,
} from './assistant.evals';
import {
  INSIGHTS_ANALYST_EVAL_AGENT_KEY,
  INSIGHTS_ANALYST_EVAL_SET,
  insightsAnalystEvalTarget,
} from './insights-analyst.evals';
import {
  DATA_READINESS_EVAL_SET,
  dataReadinessEvalTarget,
} from './data-readiness.evals';
import {
  RESULT_EXPLORER_EVAL_AGENT_KEY,
  RESULT_EXPLORER_EVAL_SET,
  resultExplorerEvalTarget,
} from './result-explorer.evals';
import {
  QUERY_EXPLAINER_EVAL_AGENT_KEY,
  QUERY_EXPLAINER_EVAL_SET,
  queryExplainerEvalTarget,
} from './query-explainer.evals';
import {
  ANALYSIS_PLANNER_EVAL_TARGET,
  ANSWER_WRITER_EVAL_TARGET,
  DATA_QUALITY_CHECK_EVAL_TARGET,
  IMAGE_READER_EVAL_TARGET,
  analysisPlannerEvalTarget,
  answerWriterEvalTarget,
  dataQualityCheckEvalTarget,
  imageReaderEvalTarget,
} from './isolated-call-targets';
import { DATA_QUALITY_CHECK_EVAL_SET } from './data-quality-check.evals';
import {
  READINESS_WORKFLOW_EVAL_TARGET,
  readinessWorkflowEvalTarget,
} from './readiness-workflow-target';

/**
 * Every eval set, of every agent that has evals (agents.md 8.1): the
 * assistant's, the Data Readiness Agent's, Insights Analyst's, the Query
 * Explainer's and the Result Explorer's. A set runs on the agent its
 * `agentKey` names, the `assistant` when it names none.
 */
export const EVAL_SETS: AssistantEvalSet[] = [
  ...ASSISTANT_EVAL_SETS,
  DATA_READINESS_EVAL_SET,
  DATA_QUALITY_CHECK_EVAL_SET,
  INSIGHTS_ANALYST_EVAL_SET,
  QUERY_EXPLAINER_EVAL_SET,
  RESULT_EXPLORER_EVAL_SET,
];

/** The registry key a set runs on. */
export function evalSetAgentKey(set: Pick<AssistantEvalSet, 'agentKey'>) {
  return set.agentKey ?? 'assistant';
}

/** The sets of one agent; empty for an agent without evals. */
export function evalSetsFor(agentKey: string): AssistantEvalSet[] {
  return EVAL_SETS.filter((set) => evalSetAgentKey(set) === agentKey);
}

/** Whether an agent has evals to run (agents.md 8). */
export function hasEvals(agentKey: string): boolean {
  return evalSetsFor(agentKey).length > 0;
}

/**
 * The eval targets that an isolated call or a second target of an agent
 * runs on, by target id (`AssistantEvalSet.target`, else the set's
 * `agentKey`). Each factory gets the sets that run on it (`setsOfTarget`),
 * so a set builder registers its set in `EVAL_SETS` and adds nothing here.
 * An agent's own target is not in this map: `evalTargetFor` builds it.
 */
const EVAL_TARGET_FACTORIES: Record<
  string,
  (sets: AssistantEvalSet[]) => EvalTarget
> = {
  [ANALYSIS_PLANNER_EVAL_TARGET]: (sets) => analysisPlannerEvalTarget(sets),
  [ANSWER_WRITER_EVAL_TARGET]: (sets) => answerWriterEvalTarget(sets),
  [IMAGE_READER_EVAL_TARGET]: (sets) => imageReaderEvalTarget(sets),
  [DATA_QUALITY_CHECK_EVAL_TARGET]: (sets) => dataQualityCheckEvalTarget(sets),
  [READINESS_WORKFLOW_EVAL_TARGET]: (sets) => readinessWorkflowEvalTarget(sets),
};

/** The target id a set runs on: its `target`, else its agent's key. */
export function evalSetTargetId(
  set: Pick<AssistantEvalSet, 'agentKey' | 'target'>,
): string {
  return set.target ?? evalSetAgentKey(set);
}

/** The registered sets that run on one target id. */
export function setsOfTarget(targetId: string): AssistantEvalSet[] {
  return EVAL_SETS.filter((set) => evalSetTargetId(set) === targetId);
}

/**
 * The one target id of the sets a run touches, or an error when they span
 * several targets — like samples, one run is one target. `fallback` is the
 * id when there are no sets.
 */
export function targetIdOfSets(
  sets: Pick<AssistantEvalSet, 'agentKey' | 'target'>[],
  fallback: string,
): { targetId: string } | { error: string } {
  const ids = [...new Set(sets.map(evalSetTargetId))];
  if (ids.length === 0) return { targetId: fallback };
  if (ids.length > 1) {
    return {
      error: `The selected questions run on several targets (${ids.join(', ')}) — run one set at a time`,
    };
  }
  return { targetId: ids[0] };
}

/**
 * The target id the selected cases run on (every case of the agent when
 * none are named), or an error when they span several targets.
 */
export function evalTargetIdFor(
  agentKey: string,
  caseIds?: string[],
): { targetId: string } | { error: string } {
  const wanted = caseIds ? new Set(caseIds) : undefined;
  return targetIdOfSets(
    evalSetsFor(agentKey).filter(
      (set) => !wanted || set.cases.some((evalCase) => wanted.has(evalCase.id)),
    ),
    agentKey,
  );
}

/**
 * The eval target of one run of `agentKey`'s sets; `caseIds` names the
 * cases of a selection, which pick the set and so its target. Throws for
 * an agent without evals: `Agent "<key>" has no evals to run`.
 */
export function evalTargetFor(
  agentKey: string,
  caseIds?: string[],
): EvalTarget {
  const picked = evalTargetIdFor(agentKey, caseIds);
  if ('error' in picked) throw new Error(picked.error);
  return evalTargetOf(picked.targetId, agentKey);
}

/** The target of one target id: a registered factory, else the agent's own. */
export function evalTargetOf(targetId: string, agentKey: string): EvalTarget {
  const factory = EVAL_TARGET_FACTORIES[targetId];
  if (factory) return factory(setsOfTarget(targetId));
  if (agentKey === 'assistant') return ASSISTANT_EVAL_TARGET;
  if (agentKey === 'data-readiness') return dataReadinessEvalTarget();
  if (agentKey === INSIGHTS_ANALYST_EVAL_AGENT_KEY)
    return insightsAnalystEvalTarget();
  if (agentKey === QUERY_EXPLAINER_EVAL_AGENT_KEY)
    return queryExplainerEvalTarget();
  if (agentKey === RESULT_EXPLORER_EVAL_AGENT_KEY)
    return resultExplorerEvalTarget();
  throw new Error(`Agent "${agentKey}" has no evals to run`);
}

/**
 * The agent the named cases run on: the one agent whose sets hold them all.
 * An error when they belong to no set or to several agents' sets.
 */
export function agentForCases(
  caseIds: string[],
): { agentKey: string } | { error: string } {
  const wanted = new Set(caseIds);
  const keys = new Set(
    EVAL_SETS.filter((set) => set.cases.some((c) => wanted.has(c.id))).map(
      evalSetAgentKey,
    ),
  );
  if (keys.size === 0) {
    return { error: 'No question set matches the selected questions' };
  }
  if (keys.size > 1) {
    return {
      error: `The selected questions run on several agents (${[...keys].join(', ')}) — run one agent's questions at a time`,
    };
  }
  return { agentKey: [...keys][0] };
}
