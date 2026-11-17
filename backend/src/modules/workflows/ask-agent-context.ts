/**
 * Ask one agent (workflows R40; agents.md 5.21; api.md 118, 119): what a
 * single-agent follow-up takes from the earlier run, as pure functions of
 * the stored run. No framework import.
 */
import { DATA_READINESS_AGENT_KEY } from '../../mastra/agent-constants';
import { ANSWER_BUSINESS_QUESTION_WORKFLOW_ID } from '../../mastra/workflows/answer-business-question.steps';
import {
  isAskableStep,
  type AskableStepId,
} from '../../mastra/workflows/ask-agent.steps';
import type { AskedStep } from '../sessions/entities/session.entity';
import { nodeChatContextBlock } from './node-chat-context';
import type { WorkflowRunDoc } from './workflow-run-steps';

/**
 * Why a request may not ask `askStep` of the earlier run, or null when it
 * may (api.md 118): only Answer a Business Question, only an askable step,
 * only a step that ran in the earlier run.
 */
export function askRefusal(
  workflowId: string,
  askStep: unknown,
  earlier: Pick<WorkflowRunDoc, 'id' | 'steps'>,
): string | null {
  if (workflowId !== ANSWER_BUSINESS_QUESTION_WORKFLOW_ID) {
    return `Workflow "${workflowId}" can't ask one agent`;
  }
  const named = typeof askStep === 'string' ? askStep : JSON.stringify(askStep);
  if (!isAskableStep(askStep)) return `Step "${named}" has no agent to ask`;
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

type Finding = NonNullable<AskedStep['earlier']>['qualityFindings'][number];

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
  /** The agent the host is bound to, when not the workflow's own (Sarah). */
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
 * - Check data quality: Sarah, bound to the host, with the step's context
 *   block and no copied thread (the host's thread would be the Analyst's);
 * - Write answer: the earlier answer's records and evidence, its plan, its
 *   data quality findings and Zoe's notes;
 * - Read images, Interpret follow-up and Plan: the step alone.
 */
export function askHostOf(
  earlier: WorkflowRunDoc,
  step: AskableStepId,
): AskHost {
  if (step === 'analyse') {
    return {
      ask: { step },
      contextBlock: nodeChatContextBlock(earlier, step),
      continuesThreads: true,
    };
  }
  if (step === 'check-data-quality') {
    return {
      ask: { step },
      agentKey: DATA_READINESS_AGENT_KEY,
      contextBlock: nodeChatContextBlock(earlier, step),
      continuesThreads: false,
    };
  }
  if (step === 'write-answer') {
    const notes = outputOf(earlier, 'read-images')?.['imageNotes'];
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
  return { ask: { step }, continuesThreads: true };
}
