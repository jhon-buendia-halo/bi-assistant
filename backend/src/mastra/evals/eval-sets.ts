import {
  ASSISTANT_EVAL_SETS,
  ASSISTANT_EVAL_TARGET,
  type AssistantEvalSet,
  type EvalTarget,
} from './assistant.evals';
import { RFP_EVAL_SET, rfpEvalTarget } from './rfp.evals';

/**
 * Every eval set, of every agent that has evals (agents.md 8.1): the
 * assistant's, then the RFP Builder's. A set runs on the agent its
 * `agentKey` names, the `assistant` when it names none.
 */
export const EVAL_SETS: AssistantEvalSet[] = [
  ...ASSISTANT_EVAL_SETS,
  RFP_EVAL_SET,
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
 * The eval target of one run of `agentKey`'s sets. `runId` tags what the run
 * creates (the RFP Builder's drafts, `eval:<runId>`). Throws for an agent
 * without evals: `Agent "<key>" has no evals to run`.
 */
export function evalTargetFor(agentKey: string, runId: string): EvalTarget {
  if (agentKey === 'assistant') return ASSISTANT_EVAL_TARGET;
  if (agentKey === 'rfp') return rfpEvalTarget(runId);
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
