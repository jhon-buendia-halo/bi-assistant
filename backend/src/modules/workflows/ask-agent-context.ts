/**
 * Ask one agent (workflows R40; agents.md 5.21; api.md 118, 119): what a
 * single-agent follow-up takes from the earlier run, as pure functions of
 * the stored run. No framework import.
 */
import {
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  chartableQueries,
} from '../../mastra/workflows/analysis.steps';
import {
  isAskableStep,
  type AskableStepId,
} from '../../mastra/workflows/ask-agent.steps';
import type {
  AskedStep,
  ToolDataRecord,
} from '../sessions/entities/session.entity';
import { analyseQueriesOf } from '../sessions/turn/turn-workflow';
import { nodeChatContextBlock } from './node-chat-context';
import type { WorkflowRunDoc } from './workflow-run-steps';

/**
 * Whether an answer's records hold a query that returned rows to chart:
 * the rule the engine's Build visual applies to the same records.
 */
function hasQueryRows(records: readonly ToolDataRecord[] | undefined): boolean {
  return chartableQueries(analyseQueriesOf(records ?? []));
}

/**
 * Why a request may not ask `askStep` of the earlier run, or null when it
 * may (api.md 118): only Answer a Business Question, only an askable step,
 * only a step that ran in the earlier run. Build visual instead needs the
 * earlier answer's query rows: Ryan charts them whether or not the earlier
 * run built a visual (its checkbox off, or nothing charted then).
 */
export function askRefusal(
  workflowId: string,
  askStep: unknown,
  earlier: Pick<WorkflowRunDoc, 'id' | 'steps' | 'answer'>,
): string | null {
  if (workflowId !== ANSWER_BUSINESS_QUESTION_WORKFLOW_ID) {
    return `Workflow "${workflowId}" can't ask one agent`;
  }
  const named = typeof askStep === 'string' ? askStep : JSON.stringify(askStep);
  if (!isAskableStep(askStep)) return `Step "${named}" has no agent to ask`;
  if (askStep === 'build-visual') {
    return hasQueryRows(earlier.answer?.data)
      ? null
      : 'The earlier answer has no query rows to chart';
  }
  const ran = earlier.steps.findLast((step) => step.id === askStep);
  if (!ran || ran.status === 'skipped' || ran.status === 'running') {
    return `Step "${askStep}" did not run in run "${earlier.id}"`;
  }
  return null;
}

/** A step's last successful output in a stored run, when it was kept. */
function outputOf(
  run: Pick<WorkflowRunDoc, 'steps'>,
  stepId: string,
): Record<string, unknown> | undefined {
  return run.steps.findLast(
    (step) => step.id === stepId && step.status === 'success',
  )?.output;
}

type Finding = NonNullable<
  NonNullable<AskedStep['earlier']>['qualityFindings']
>[number];

/** The well-formed `{ check, passed, detail }` entries of a list. */
function findingsOf(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): Finding[] => {
    const finding = entry as Record<string, unknown> | null;
    return finding &&
      typeof finding['check'] === 'string' &&
      typeof finding['passed'] === 'boolean' &&
      typeof finding['detail'] === 'string'
      ? [
          {
            check: finding['check'],
            passed: finding['passed'],
            detail: finding['detail'],
          },
        ]
      : [];
  });
}

/** How the run host of a single-agent follow-up is set up (agents.md 5.21). */
export interface AskHost {
  ask: AskedStep;
  /** The agent the host is bound to, when not the workflow's own. */
  agentKey?: string;
  /** The earlier step's context block, for an agent that answers with tools. */
  contextBlock?: string;
  /** Whether the host starts from copies of the earlier run's threads. */
  continuesThreads: boolean;
}

/**
 * The host of a follow-up that asks `step` of `earlier` (agents.md 5.21):
 * - Analyse: the Analyst, from copies of the run's threads, with the step's
 *   context block (as its node chat has it);
 * - Write answer: the earlier answer's records and evidence, its plan, its
 *   data quality findings (a run stored before Check data quality left the
 *   workflow) and Zoe's notes;
 * - Build visual: the earlier answer's records and evidence, with the
 *   question and answer text of `charted` (the run whose answer they are:
 *   the earlier run, or the one it asked Ryan of, see `chartedRunOf`);
 * - Read images, Interpret follow-up and Plan: the step alone.
 */
export function askHostOf(
  earlier: WorkflowRunDoc,
  step: AskableStepId,
  charted: Pick<WorkflowRunDoc, 'question' | 'answer'> = earlier,
): AskHost {
  if (step === 'analyse') {
    return {
      ask: { step },
      contextBlock: nodeChatContextBlock(earlier, step),
      continuesThreads: true,
    };
  }
  if (step === 'write-answer') {
    const notes = outputOf(earlier, 'read-images')?.['imageNotes'];
    // A run stored before Check data quality left the workflow keeps its
    // findings; Jessica reads them again.
    const quality = findingsOf(
      outputOf(earlier, 'check-data-quality')?.['findings'],
    ).filter((finding) => finding.check.startsWith('Data quality'));
    return {
      ask: {
        step,
        earlier: {
          plan: outputOf(earlier, 'plan')?.['plan'] ?? null,
          qualityFindings: quality,
          imageNotes: typeof notes === 'string' ? notes : '',
          records: [...(earlier.answer?.data ?? [])],
          evidence: [...(earlier.answer?.evidence ?? [])],
        },
      },
      continuesThreads: true,
    };
  }
  if (step === 'build-visual') {
    // Ryan charts the earlier answer's rows; they are carried into this
    // run's answer with their evidence.
    return {
      ask: {
        step,
        earlier: {
          question: charted.question ?? '',
          answer: charted.answer?.content ?? '',
          records: [...(earlier.answer?.data ?? [])],
          evidence: [...(earlier.answer?.evidence ?? [])],
        },
      },
      continuesThreads: true,
    };
  }
  return { ask: { step }, continuesThreads: true };
}

/** How many asks of Build visual `chartedRunOf` walks back at most. */
const CHARTED_RUN_HOPS = 20;

/**
 * The run whose answer Ryan charts when `earlier` is asked Build visual
 * (agents.md 5.21): a run that itself asked Ryan alone answered with a
 * code-written line and the follow-up's words, so its question and answer
 * are those of the run it asked of, walking back to a run that did not.
 * A run that can no longer be read ends the walk at the last one read.
 */
export async function chartedRunOf(
  earlier: WorkflowRunDoc,
  get: (id: string) => Promise<WorkflowRunDoc | null>,
): Promise<WorkflowRunDoc> {
  let run = earlier;
  for (let hop = 0; hop < CHARTED_RUN_HOPS; hop += 1) {
    const context = run.context as
      { fromRunId?: unknown; askStep?: unknown } | undefined;
    if (
      context?.askStep !== 'build-visual' ||
      typeof context.fromRunId !== 'string'
    ) {
      return run;
    }
    const before = await get(context.fromRunId);
    if (!before?.answer?.content) return run;
    run = before;
  }
  return run;
}
