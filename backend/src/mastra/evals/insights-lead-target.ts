import type { Agent } from '@mastra/core/agent';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_NAME,
} from '../agents/insights-lead-catalog';
import { INSIGHTS_LEAD_WORKFLOW_ID } from '../workflows/conversation-turn.steps';
import type {
  AssistantEvalSet,
  EvalRawToolCall,
  EvalTarget,
} from './assistant.evals';
import {
  installedEvalRuns,
  lastUserText,
  type AveryEvalRuns,
  type StoredRunToolCall,
} from './avery-workflow-target';
import {
  EVAL_DETAILS_KEY,
  type EvalRunDetails,
  type EvalRunRecord,
} from './eval-details';
import { answerResult } from './query-explainer-eval-answer';

/**
 * The `insights-lead` eval target (agents.md 8.1, plan Elena 5): every case
 * is ONE whole run of Elena's conversation (`agent:insights-lead`, one step
 * `answer`), started as `POST /workflows/:id/runs` starts one: the app's run
 * service (`WorkflowRunsService.prepare`, then `stream`) with the input
 * `{ question, datasets }`, the same service Avery's target uses
 * (`workflowEvalRunsOf`). What she did is read back from the stored run: its
 * status, its `answer` step (the output's `answer`, its `toolCalls`), what it
 * waits for, the stored answer's query rows and its `checks`. The stored run
 * is deleted once read.
 *
 * - `text`, the scored answer: her answer, or, when the run waits for the
 *   user, her question with its options, one per line (`- <option>`).
 * - the tool calls: every call of the step, in order.
 * - `evalDetails.output`: the run as the checks read it (`InsightsLeadRunView`).
 * - `evalDetails.records`: the stored answer's tool records, which the
 *   result-set check compares with a case's `expectedSql`.
 *
 * Framework-free, so Jest loads it; her agent loads on first use.
 */

/** The target id (`AssistantEvalSet.target`). */
export const INSIGHTS_LEAD_EVAL_TARGET = 'insights-lead-workflow';

/** The check a stored answer carries (`ChatMessage.checks`). */
export interface StoredAnswerCheck {
  check: string;
  passed: boolean;
  detail: string;
}

/** The part of a stored run (`WorkflowRun`, api.md 121) the target reads. */
export interface StoredInsightsLeadRun {
  id: string;
  status: string;
  error?: string;
  steps: {
    id: string;
    status?: string;
    output?: Record<string, unknown>;
    toolCalls?: StoredRunToolCall[];
  }[];
  output?: Record<string, unknown>;
  waitingFor?: { question: string; options: string[] };
  answer?: {
    content: string;
    data?: EvalRunRecord[];
    checks?: StoredAnswerCheck[];
  };
}

/** One call as the checks read it. */
export interface InsightsLeadRunCall {
  tool: string;
  input?: string;
  rowCount?: number;
  error?: string;
}

/** A run of her conversation as the checks read it (`details.output`). */
export interface InsightsLeadRunView {
  runId: string;
  /** The stored run's status: `success`, `suspended` (she asks), `failed`, … */
  status: string;
  error?: string;
  /** The question she asks the user, when the run waits for the answer. */
  waitingFor?: { question: string; options: string[] };
  /** The run's answer, as the user reads it. */
  answer: string;
  /** Every call of the `answer` step, in call order. */
  calls: InsightsLeadRunCall[];
  /** The rows of her queries, as the stored answer keeps them. */
  rows: Record<string, unknown>[];
  /** The findings stored with the answer (the last attempt's). */
  checks: StoredAnswerCheck[];
  /**
   * How many attempts the turn made: 1, or 2 after a repair round (the step
   * output's `attempts`; 1 when the run does not say).
   */
  attempts: number;
}

/** The step id of her conversation. */
const ANSWER_STEP = 'answer';

/** A stored run as the checks read it (`InsightsLeadRunView`). */
export function insightsLeadRunView(
  run: StoredInsightsLeadRun,
): InsightsLeadRunView {
  const step =
    run.steps.find((candidate) => candidate.id === ANSWER_STEP) ?? run.steps[0];
  const calls: InsightsLeadRunCall[] = (step?.toolCalls ?? []).map((call) => ({
    tool: call.tool,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
  }));
  const stepAnswer = step?.output?.['answer'];
  const runAnswer = run.output?.['answer'];
  const answer =
    typeof stepAnswer === 'string'
      ? stepAnswer
      : typeof runAnswer === 'string'
        ? runAnswer
        : (run.answer?.content ?? '');
  const waiting = run.status === 'suspended' ? run.waitingFor : undefined;
  const attempts = step?.output?.['attempts'];
  return {
    runId: run.id,
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
    ...(waiting
      ? {
          waitingFor: {
            question: waiting.question,
            options: [...waiting.options],
          },
        }
      : {}),
    answer: answer.trim(),
    calls,
    rows: (run.answer?.data ?? []).flatMap((record) => record.rows ?? []),
    checks: run.answer?.checks ?? [],
    attempts:
      typeof attempts === 'number' && attempts >= 1 ? Math.floor(attempts) : 1,
  };
}

/** The scored answer of a run: her answer, or her question and options. */
export function insightsLeadScoredAnswer(view: InsightsLeadRunView): string {
  if (view.waitingFor) {
    return [
      `${INSIGHTS_LEAD_NAME} asks the user:`,
      view.waitingFor.question,
      ...view.waitingFor.options.map((option) => `- ${option}`),
    ].join('\n');
  }
  return view.answer || '(none)';
}

/** The run's calls as the report and the judge read them. */
export function insightsLeadRawToolCalls(
  view: InsightsLeadRunView,
): EvalRawToolCall[] {
  return view.calls.map((call) => ({
    name: call.tool,
    input: call.input !== undefined ? { input: call.input } : {},
    output: call.error
      ? { error: call.error }
      : call.rowCount !== undefined
        ? { rowCount: call.rowCount }
        : undefined,
    failed: Boolean(call.error),
  }));
}

/**
 * The run's tool records as the stored answer keeps them, for the
 * result-set check (`EvalRunDetails.records`).
 */
export function insightsLeadRecords(
  run: StoredInsightsLeadRun,
): EvalRunRecord[] {
  return run.answer?.data ?? [];
}

/** The view as an agent result: the shape `runAssistantEvalCase` reads. */
export function insightsLeadTargetResult(
  input: unknown,
  view: InsightsLeadRunView,
  /** The run's records (`insightsLeadRecords`). */
  records: EvalRunRecord[] = [],
) {
  const raw = insightsLeadRawToolCalls(view);
  const ids = raw.map((_call, index) => `insights-lead-run-call-${index + 1}`);
  return {
    ...answerResult(input, insightsLeadScoredAnswer(view)),
    steps: [
      {
        toolCalls: raw.map((call, index) => ({
          payload: {
            toolCallId: ids[index],
            toolName: call.name,
            args: call.input,
          },
        })),
        toolResults: raw.map((call, index) => ({
          payload: {
            toolCallId: ids[index],
            toolName: call.name,
            result: call.output,
          },
        })),
      },
    ],
    [EVAL_DETAILS_KEY]: { output: view, records } satisfies EvalRunDetails,
  };
}

type GenerateOptions = {
  requestContext?: { get(key: string): unknown };
  [key: string]: unknown;
};

/** The run service of her workflow, installed at boot. */
export function insightsLeadEvalRuns(): AveryEvalRuns {
  return installedEvalRuns(INSIGHTS_LEAD_WORKFLOW_ID);
}

/**
 * Elena, her `generate` running one whole conversation run (above). Every
 * other member is the agent's own.
 */
export function insightsLeadTurnAgent(
  agent: Agent,
  services: () => AveryEvalRuns = insightsLeadEvalRuns,
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const given = options.requestContext?.get(DATASETS_CONTEXT_KEY);
    const datasets = Array.isArray(given) ? (given as string[]) : [];
    if (!datasets.length) {
      throw new Error('An Insights Lead case needs a dataset');
    }
    const runs = services();
    const run = await runs.run({
      question: lastUserText(input).trim(),
      datasets,
    });
    try {
      return insightsLeadTargetResult(
        input,
        insightsLeadRunView(run),
        insightsLeadRecords(run),
      );
    } finally {
      await runs.remove(run.id).catch(() => undefined);
    }
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

/** Her agent, required on first use (it loads the workflow modules). */
function loadInsightsLead(): Agent {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { insightsLeadAgent } = require('../agents/insights-lead.agent') as {
    insightsLeadAgent: Agent;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return insightsLeadAgent;
}

/**
 * The eval target of the `insights-lead` sets: Elena (agent
 * `insights-lead`), each case one whole run of her conversation. Nothing of
 * the runner's context reaches the run (no orientation or knowledge block):
 * the run builds its own, as in the app.
 */
export function insightsLeadEvalTarget(
  sets: AssistantEvalSet[],
  loadAgent: () => Agent = loadInsightsLead,
  services: () => AveryEvalRuns = insightsLeadEvalRuns,
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: INSIGHTS_LEAD_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= insightsLeadTurnAgent((agent ??= loadAgent()), services);
      return run;
    },
    sets,
    sendsKnowledge: false,
    // Her answer is a whole answer: the judge reads it, and her calls.
    judgeTraceChars: 4_000,
    orientation: () => '',
  };
}
