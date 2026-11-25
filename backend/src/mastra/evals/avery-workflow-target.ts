import type { Agent } from '@mastra/core/agent';
import type * as ChiefOfStaff from '../agents/chief-of-staff.agent';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import type {
  AssistantEvalSet,
  EvalRawToolCall,
  EvalTarget,
} from './assistant.evals';
import { EVAL_DETAILS_KEY, type EvalRunDetails } from './eval-details';
import { answerResult } from './query-explainer-eval-answer';

/**
 * The `avery-michael-workflow` eval target (agents.md 8.1, 5.23): every case
 * is ONE whole run of Answer a Business Question (Avery + Michael)
 * (`orchestrated-answer-michael`), started as `POST /workflows/:id/runs`
 * starts one: the app's run service (`WorkflowRunsService.prepare`, then
 * `stream`) with the input `{ question, datasets }` (the case's question and
 * the run's datasets). What Avery did is read back from the stored run, not
 * from her agent alone, so the target depends only on what both the base and
 * the branch store: the run's status, its Orchestrate step (its output's
 * `answer` and its `toolCalls`, Avery's signed `agent: 'chief-of-staff'`,
 * Michael's unsigned), what it waits for, and the answer's query rows.
 * The stored run is deleted once read.
 *
 * - `text`, the scored answer: Michael's answer and Avery's closing, each
 *   under its own label (`Michael's answer:`, `Avery's closing:`), or, when
 *   the run waits for the user, Avery's question with its options, one per
 *   line (`- <option>`).
 * - the tool calls: every call of the step, in order (`averyRawToolCalls`).
 * - `evalDetails.output`: the run as the checks read it (`AveryRunView`).
 *
 * The run service is installed at boot (`AveryEvalBridge`, as
 * `QueryExplainerEvalBridge` installs its service): the eval sets are built
 * before any Nest provider exists. Framework-free, so Jest loads it.
 */

/** The target id (`AssistantEvalSet.target`). */
export const AVERY_WORKFLOW_EVAL_TARGET = 'avery-michael-workflow';

/** The workflow each case runs (workflows R45). */
export const AVERY_WORKFLOW_ID = 'orchestrated-answer-michael';

/** One tool call of a stored run's step (api.md 3.1; `WorkflowRunToolCall`). */
export interface StoredRunToolCall {
  tool: string;
  input?: string;
  rowCount?: number;
  error?: string;
  rationale?: string;
  /** Avery's registry key on her own calls; absent on a teammate's. */
  agent?: string;
  teammate?: string;
  /** A team call's result: what the teammate handed back. */
  reply?: string;
}

/** The part of a stored run (`WorkflowRun`, api.md 121) the target reads. */
export interface StoredAveryRun {
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
    data?: { tool: string; input?: string; rows?: Record<string, unknown>[] }[];
  };
}

/** One call as the checks read it: who made it, and what it ran. */
export interface AveryRunCall {
  tool: string;
  /** `chief-of-staff` on Avery's own calls; absent on Michael's. */
  agent?: string;
  /** Her brief, the skill or file she read, or his SQL. */
  input?: string;
  /** A team call's result: Michael's reply, as she read it. */
  reply?: string;
  rowCount?: number;
  error?: string;
}

/** A run of the workflow as the checks read it (`details.output`). */
export interface AveryRunView {
  runId: string;
  /** The stored run's status: `success`, `suspended` (it asks), `failed`, … */
  status: string;
  error?: string;
  /** The question Avery asks the user, when the run waits for the answer. */
  waitingFor?: { question: string; options: string[] };
  /** The run's answer: Michael's answer, then Avery's closing. */
  answer: string;
  /** Michael's written answer (his last), as the run's answer starts. */
  michaelAnswer: string;
  /** Avery's closing words, after Michael's answer. */
  closing: string;
  /** Every call of the Orchestrate step, in call order. */
  calls: AveryRunCall[];
  /** The rows of Michael's queries, as the answer keeps them. */
  rows: Record<string, unknown>[];
}

/** The run service as the target uses it. */
export interface AveryEvalRuns {
  /** One whole run on `{ question, datasets }`, as the run store keeps it. */
  run(input: { question: string; datasets: string[] }): Promise<StoredAveryRun>;
  /** Delete a stored run (and drop it if it waits). */
  remove(runId: string): Promise<void>;
}

/**
 * The part of `WorkflowRunsService` the target needs (api.md 118, 119, 151):
 * the same methods on the base and the branch.
 */
export interface WorkflowRunsLike<Prepared> {
  prepare(id: string, body: unknown): Promise<Prepared>;
  stream(
    prepared: Prepared,
    emit: (event: { type: string; runId?: string }) => void,
  ): Promise<StoredAveryRun>;
  delete(id: string): Promise<void>;
}

/**
 * The target's run service over the app's, for one workflow id: a run is
 * prepared as the route prepares it (a refused input throws its 400) and
 * streamed to its end; a run that throws after it was stored is deleted
 * before the error goes on. Avery's workflow and Elena's
 * (`agent:insights-lead`) both run through it.
 */
export function workflowEvalRunsOf<Prepared>(
  runs: WorkflowRunsLike<Prepared>,
  workflowId: string,
): AveryEvalRuns {
  return {
    run: async (input) => {
      const prepared = await runs.prepare(workflowId, { input });
      let runId: string | undefined;
      try {
        return await runs.stream(prepared, (event) => {
          if (event.type === 'run' && typeof event.runId === 'string') {
            runId = event.runId;
          }
        });
      } catch (error) {
        if (runId) await runs.delete(runId).catch(() => undefined);
        throw error;
      }
    },
    remove: (runId) => runs.delete(runId),
  };
}

/** Avery's workflow's run service (`workflowEvalRunsOf`). */
export function averyEvalRunsOf<Prepared>(
  runs: WorkflowRunsLike<Prepared>,
): AveryEvalRuns {
  return workflowEvalRunsOf(runs, AVERY_WORKFLOW_ID);
}

let installed: WorkflowRunsLike<unknown> | undefined;

/**
 * Installed at boot by `AveryEvalBridge` (it serves every workflow eval
 * target: Avery's and Elena's); `undefined` uninstalls.
 */
export function installAveryEvalRuns<Prepared>(
  runs: WorkflowRunsLike<Prepared> | undefined,
): void {
  installed = runs;
}

/** The installed run service for one workflow; throws when none is installed. */
export function installedEvalRuns(workflowId: string): AveryEvalRuns {
  if (!installed) {
    throw new Error(
      'The workflow evals need the workflow run service, which the app installs at start-up',
    );
  }
  return workflowEvalRunsOf(installed, workflowId);
}

/** The installed run service for Avery's workflow. */
export function averyEvalRuns(): AveryEvalRuns {
  return installedEvalRuns(AVERY_WORKFLOW_ID);
}

/** The text of the last user message of an agent input. */
export function lastUserText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  for (const message of [...(input as unknown[])].reverse()) {
    const entry = message as { role?: unknown; content?: unknown };
    if (entry?.role !== 'user') continue;
    if (typeof entry.content === 'string') return entry.content;
    if (Array.isArray(entry.content)) {
      return entry.content
        .map((part) =>
          typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('');
    }
  }
  return '';
}

/** The most a stored team call's reply keeps (`TOOL_CALL_INPUT_CAP`). */
export const STORED_REPLY_CAP = 2_000;

/**
 * The run's answer split into Michael's answer and Avery's closing. The run
 * writes `<Michael's last answer>\n\n<her closing>` (her words alone when he
 * wrote none); his answer is the reply of her last answer_from_data call
 * that the answer starts with. A reply the store cut at its cap cannot end
 * his part, so then her closing is the answer's last paragraph.
 */
export function splitClosing(
  answer: string,
  calls: readonly AveryRunCall[],
): { michaelAnswer: string; closing: string } {
  const text = answer.trim();
  const replies = calls
    .filter(
      (call) =>
        call.agent === CHIEF_OF_STAFF_AGENT_KEY &&
        call.tool === 'answer_from_data' &&
        call.reply?.trim(),
    )
    .map((call) => call.reply!)
    .reverse();
  const stored = replies.find((candidate) => text.startsWith(candidate.trim()));
  if (stored === undefined) return { michaelAnswer: '', closing: text };
  const reply = stored.trim();
  // The store cuts a reply at its cap after trimming it: one that long may
  // be cut, whatever it ends with.
  if (stored.length < STORED_REPLY_CAP) {
    return {
      michaelAnswer: reply,
      closing: text.slice(reply.length).trim(),
    };
  }
  const cut = text.lastIndexOf('\n\n');
  if (cut < reply.length) return { michaelAnswer: text, closing: '' };
  return {
    michaelAnswer: text.slice(0, cut).trim(),
    closing: text.slice(cut).trim(),
  };
}

/** A stored run as the checks read it (`AveryRunView`). */
export function averyRunView(run: StoredAveryRun): AveryRunView {
  const step =
    run.steps.find((candidate) => candidate.id === 'orchestrate') ??
    run.steps[0];
  const calls: AveryRunCall[] = (step?.toolCalls ?? []).map((call) => ({
    tool: call.tool,
    ...(call.agent ? { agent: call.agent } : {}),
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.reply !== undefined ? { reply: call.reply } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
  }));
  // The step's own output first: the stored answer message may carry the
  // figure links the run adds to it.
  const stepAnswer = step?.output?.['answer'];
  const runAnswer = run.output?.['answer'];
  const answer =
    typeof stepAnswer === 'string'
      ? stepAnswer
      : typeof runAnswer === 'string'
        ? runAnswer
        : (run.answer?.content ?? '');
  const waiting = run.status === 'suspended' ? run.waitingFor : undefined;
  const { michaelAnswer, closing } = waiting
    ? { michaelAnswer: '', closing: '' }
    : splitClosing(answer, calls);
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
    michaelAnswer,
    closing,
    calls,
    rows: (run.answer?.data ?? []).flatMap((record) => record.rows ?? []),
  };
}

/** The scored answer of a run (the labels above). */
export function averyScoredAnswer(view: AveryRunView): string {
  if (view.waitingFor) {
    return [
      'Avery asks the user:',
      view.waitingFor.question,
      ...view.waitingFor.options.map((option) => `- ${option}`),
    ].join('\n');
  }
  return [
    ...(view.michaelAnswer
      ? ["Michael's answer:", view.michaelAnswer, '']
      : []),
    "Avery's closing:",
    view.closing || '(none)',
  ].join('\n');
}

/** The run's calls as the report and the judge read them. */
export function averyRawToolCalls(view: AveryRunView): EvalRawToolCall[] {
  return view.calls.map((call) => ({
    name: call.tool,
    input: {
      by: call.agent ?? 'insights-analyst',
      ...(call.input !== undefined ? { input: call.input } : {}),
    },
    output: call.error
      ? { error: call.error }
      : call.reply !== undefined
        ? call.reply
        : call.rowCount !== undefined
          ? { rowCount: call.rowCount }
          : undefined,
    failed: Boolean(call.error),
  }));
}

/** The view as an agent result: the shape `runAssistantEvalCase` reads. */
export function averyTargetResult(input: unknown, view: AveryRunView) {
  const raw = averyRawToolCalls(view);
  const ids = raw.map((_call, index) => `avery-run-call-${index + 1}`);
  return {
    ...answerResult(input, averyScoredAnswer(view)),
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
    [EVAL_DETAILS_KEY]: { output: view } satisfies EvalRunDetails,
  };
}

type GenerateOptions = {
  requestContext?: { get(key: string): unknown };
  [key: string]: unknown;
};

/**
 * Avery, her `generate` running one whole workflow run (above). Every other
 * member is the agent's own.
 */
export function averyWorkflowTurnAgent(
  agent: Agent,
  services: () => AveryEvalRuns = averyEvalRuns,
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const given = options.requestContext?.get(DATASETS_CONTEXT_KEY);
    const datasets = Array.isArray(given) ? (given as string[]) : [];
    if (!datasets.length) {
      throw new Error('An Avery + Michael case needs a dataset');
    }
    const runs = services();
    const run = await runs.run({
      question: lastUserText(input).trim(),
      datasets,
    });
    try {
      return averyTargetResult(input, averyRunView(run));
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

/** Avery's agent, required on first use (it loads the workflow modules). */
function loadChiefOfStaff(): Agent {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { chiefOfStaffAgent } =
    require('../agents/chief-of-staff.agent') as typeof ChiefOfStaff;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return chiefOfStaffAgent;
}

/**
 * The eval target of the `avery-michael-workflow` sets: Avery (agent
 * `chief-of-staff`), each case one whole run of the workflow. Nothing of
 * the runner's context reaches the run (no orientation or knowledge block):
 * the run builds its own, as in the app.
 */
export function averyWorkflowEvalTarget(
  sets: AssistantEvalSet[],
  loadAgent: () => Agent = loadChiefOfStaff,
  services: () => AveryEvalRuns = averyEvalRuns,
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: CHIEF_OF_STAFF_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= averyWorkflowTurnAgent((agent ??= loadAgent()), services);
      return run;
    },
    sets,
    sendsKnowledge: false,
    // Michael's replies and briefs are whole answers: the judge reads them.
    judgeTraceChars: 4_000,
    orientation: () => '',
  };
}
