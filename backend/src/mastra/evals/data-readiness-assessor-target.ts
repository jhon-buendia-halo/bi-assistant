import type { Agent } from '@mastra/core/agent';
import type { ReadinessAssessment } from '../../modules/readiness-assessor/readiness.types';
import { DATA_READINESS_ASSESSOR_AGENT_KEY } from '../agents/data-readiness-assessor-catalog';
import {
  getReadinessToolServices,
  setReadinessToolServices,
  type ReadinessToolServices,
} from '../readiness-tool-services';
import type { readinessModelView } from '../tools/readiness.tools';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import { DATA_READINESS_ASSESSOR_WORKFLOW_ID } from '../workflows/conversation-turn.steps';
import type {
  AssistantEvalSet,
  EvalRawToolCall,
  EvalTarget,
} from './assistant.evals';
import {
  installedEvalRuns,
  lastUserText,
  type AveryEvalRuns,
} from './avery-workflow-target';
import {
  EVAL_DETAILS_KEY,
  type EvalRunDetails,
  type EvalRunRecord,
} from './eval-details';
import {
  insightsLeadRecords,
  insightsLeadRunView,
  type InsightsLeadRunView,
  type StoredInsightsLeadRun,
} from './insights-lead-target';
import { answerResult } from './query-explainer-eval-answer';

/**
 * The `data-readiness-assessor` eval target (agents.md 8.1, plan
 * data-readiness-assessor U4): every case is ONE whole run of Dana's
 * conversation (`agent:data-readiness-assessor`, engine
 * `data-readiness-assessor-conversation`, one step `answer`), started
 * through the app's run service as Elena's target starts hers
 * (`workflowEvalRunsOf`), with the input `{ question, datasets }`. Her model
 * is the run's: no Opus routing, as in the app.
 *
 * A stored run keeps no tool output, so what `assess_readiness` returned is
 * read where the tool put it: the assessments it saved during the run (the
 * readiness bridge's `save`, tapped for the run), each turned into the
 * projection the model read (`readinessModelView`, the tool's
 * `toModelOutput`). The checks compare her answer with that.
 *
 * - `text`, the scored answer: her report, or, when the run waits for the
 *   user, her question with its options, one per line (`- <option>`).
 * - the tool calls: every call of the step, in order; each successful
 *   `assess_readiness` call carries the projection it returned.
 * - `evalDetails.output`: the run as the checks read it (`DanaRunView`).
 * - `evalDetails.records`: the stored answer's tool records.
 *
 * Framework-free at load, so Jest loads it; her agent loads on first use.
 */

/** The target id (`AssistantEvalSet.target`). */
export const DATA_READINESS_ASSESSOR_EVAL_TARGET =
  'data-readiness-assessor-workflow';

/** Her name, as the scored answer of a waiting run says it. */
const DANA = 'Dana';

/** What `assess_readiness` handed the model (its `toModelOutput`). */
export type ReadinessModelView = ReturnType<typeof readinessModelView>;

/** A run of her conversation as the checks read it (`details.output`). */
export interface DanaRunView extends InsightsLeadRunView {
  /**
   * What each `assess_readiness` call of the run returned to her, in call
   * order, as she read it: the verdict, gates, levels, findings, evidence
   * (aggregates only) and what was not evaluated.
   */
  assessments: ReadinessModelView[];
  /** The stored answer's tool records (her queries and samples, with rows). */
  records: EvalRunRecord[];
}

/**
 * The tool's projection (`readinessModelView`), required on first use: the
 * tool module loads the framework, and this one stays free of it.
 */
function modelViewOf(assessment: ReadinessAssessment): ReadinessModelView {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const tools =
    require('../tools/readiness.tools') as typeof import('../tools/readiness.tools');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return tools.readinessModelView(assessment);
}

/** The view of a stored run and the assessments it saved. */
export function danaRunView(
  run: StoredInsightsLeadRun,
  assessments: readonly ReadinessAssessment[],
): DanaRunView {
  return {
    ...insightsLeadRunView(run),
    assessments: assessments.map(modelViewOf),
    records: insightsLeadRecords(run),
  };
}

/** The scored answer of a run: her report, or her question and options. */
export function danaScoredAnswer(view: InsightsLeadRunView): string {
  if (view.waitingFor) {
    return [
      `${DANA} asks the user:`,
      view.waitingFor.question,
      ...view.waitingFor.options.map((option) => `- ${option}`),
    ].join('\n');
  }
  return view.answer || '(none)';
}

/**
 * The run's calls as the report and the judge read them: the n-th
 * successful `assess_readiness` call gets the n-th assessment's projection
 * as its output.
 */
export function danaRawToolCalls(view: DanaRunView): EvalRawToolCall[] {
  let assessed = 0;
  return view.calls.map((call) => {
    let output: unknown = call.error
      ? { error: call.error }
      : call.rowCount !== undefined
        ? { rowCount: call.rowCount }
        : undefined;
    if (call.tool === 'assess_readiness' && !call.error) {
      output = view.assessments[assessed++] ?? output;
    }
    return {
      name: call.tool,
      input: call.input !== undefined ? { input: call.input } : {},
      output,
      failed: Boolean(call.error),
    };
  });
}

/** The view as an agent result: the shape `runAssistantEvalCase` reads. */
export function danaTargetResult(input: unknown, view: DanaRunView) {
  const raw = danaRawToolCalls(view);
  const ids = raw.map((_call, index) => `dana-run-call-${index + 1}`);
  return {
    ...answerResult(input, danaScoredAnswer(view)),
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
    [EVAL_DETAILS_KEY]: {
      output: view,
      records: view.records,
    } satisfies EvalRunDetails,
  };
}

/** Marks the bridge the target tapped, so it is tapped once. */
const TAPPED = Symbol('data-readiness-assessor-eval-tap');

type Tapped = ReadinessToolServices & { [TAPPED]?: true };

/** Who hears of each saved assessment while a run is in flight. */
const listeners = new Set<(assessment: ReadinessAssessment) => void>();

/** The readiness bridge as the tap reads and replaces it (tests inject one). */
export interface ReadinessBridge {
  get(): ReadinessToolServices;
  set(services: ReadinessToolServices): void;
}

const APP_BRIDGE: ReadinessBridge = {
  get: getReadinessToolServices,
  set: setReadinessToolServices,
};

/**
 * Run `fn` and collect every assessment `assess_readiness` saved meanwhile.
 * The installed readiness services are wrapped once (saving still goes to
 * the store first); a bridge reinstalled since is wrapped again.
 */
export async function capturingAssessments<T>(
  fn: () => Promise<T>,
  bridge: ReadinessBridge = APP_BRIDGE,
): Promise<{ result: T; saved: ReadinessAssessment[] }> {
  const current = bridge.get() as Tapped;
  if (!current[TAPPED]) {
    const tapped: Tapped = {
      previous: (useCaseKey) => current.previous(useCaseKey),
      save: async (assessment) => {
        await current.save(assessment);
        for (const listener of listeners) listener(assessment);
      },
      [TAPPED]: true,
    };
    bridge.set(tapped);
  }
  const saved: ReadinessAssessment[] = [];
  const listener = (assessment: ReadinessAssessment) => {
    saved.push(assessment);
  };
  listeners.add(listener);
  try {
    return { result: await fn(), saved };
  } finally {
    listeners.delete(listener);
  }
}

/**
 * The assessments of one run among those saved while it ran: the ones whose
 * session names the run, else all of them (a run's turn may record no
 * session; cases run one at a time, agents-evals R23).
 */
export function assessmentsOfRun(
  runId: string,
  saved: readonly ReadinessAssessment[],
): ReadinessAssessment[] {
  const own = saved.filter((assessment) =>
    assessment.sessionId?.includes(runId),
  );
  return own.length ? own : [...saved];
}

type GenerateOptions = {
  requestContext?: { get(key: string): unknown };
  [key: string]: unknown;
};

/** The run service of her conversation, installed at boot. */
export function danaEvalRuns(): AveryEvalRuns {
  return installedEvalRuns(DATA_READINESS_ASSESSOR_WORKFLOW_ID);
}

/**
 * Dana, her `generate` running one whole conversation run (above). Every
 * other member is the agent's own.
 */
export function danaTurnAgent(
  agent: Agent,
  services: () => AveryEvalRuns = danaEvalRuns,
  bridge: ReadinessBridge = APP_BRIDGE,
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const given = options.requestContext?.get(DATASETS_CONTEXT_KEY);
    const datasets = Array.isArray(given) ? (given as string[]) : [];
    if (!datasets.length) {
      throw new Error('A Data Readiness Assessor case needs a dataset');
    }
    const runs = services();
    const { result: run, saved } = await capturingAssessments(
      () =>
        runs.run({
          question: lastUserText(input).trim(),
          datasets,
        }) as Promise<StoredInsightsLeadRun>,
      bridge,
    );
    try {
      return danaTargetResult(
        input,
        danaRunView(run, assessmentsOfRun(run.id, saved)),
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
function loadDana(): Agent {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { dataReadinessAssessorAgent } =
    require('../agents/data-readiness-assessor.agent') as {
      dataReadinessAssessorAgent: Agent;
    };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return dataReadinessAssessorAgent;
}

/**
 * The eval target of the `data-readiness-assessor` set: Dana, each case one
 * whole run of her conversation. Nothing of the runner's context reaches
 * the run (no orientation or knowledge block): the run builds its own.
 */
export function dataReadinessAssessorEvalTarget(
  sets: AssistantEvalSet[],
  loadAgent: () => Agent = loadDana,
  services: () => AveryEvalRuns = danaEvalRuns,
  bridge: ReadinessBridge = APP_BRIDGE,
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: DATA_READINESS_ASSESSOR_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= danaTurnAgent((agent ??= loadAgent()), services, bridge);
      return run;
    },
    sets,
    sendsKnowledge: false,
    // Her report is long and her assessment is one big output: the judge
    // and the report read more of each call.
    judgeTraceChars: 8_000,
    orientation: () => '',
  };
}
