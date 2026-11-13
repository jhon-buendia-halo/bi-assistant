import type { Agent } from '@mastra/core/agent';
import type * as StepAgents from '../workflows/qti-v2-turn.agents';
import type * as TurnWorkflow from '../workflows/qti-v2-turn.workflow';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  clarifyingQuestionOf,
  type ClarifyingQuestion,
  type QtiV2TurnRuntime,
} from '../workflows/qti-v2-turn.steps';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { parseClarification } from '../tools/clarification.tool';
import { analyseAttemptOf } from '../../modules/sessions/turn/turn-workflow';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import { captureStepRecords } from './assistant.evals';

/**
 * The `assistant-v2` eval target's turn (agents.md 8.1): every case runs the
 * WHOLE `qti-v2-turn` workflow, as a run does (5.11), not the agent alone.
 * `runEvals` calls the agent's `generate`; this target is the agent with
 * `generate` replaced by one run of the workflow, whose:
 * - Plan and Write answer steps call the model as a run's do;
 * - Analyse step is the agent's own `generate` with the case's options (its
 *   orientation, knowledge, step budget and scorer data) plus the catalog
 *   and plan blocks, so the scorers and checks read Analyse's tool calls
 *   (the last attempt's, when Validate made it retry);
 * - answer (the scored text) is Write answer's, or, when the run is
 *   suspended on a clarifying question (Clarify's, or Analyse's after
 *   `ask_clarification`; ADR-0043), the question with its options, one per
 *   line (`- <option>`). A case never answers it: the suspended run is
 *   discarded (its snapshot deleted).
 */

/** What the workflow target runs on; tests stand in for each part. */
export interface WorkflowTargetParts {
  workflow: {
    createRun(): Promise<{
      runId?: string;
      stream(args: { inputData: unknown; requestContext: unknown }): {
        fullStream: AsyncIterable<unknown>;
        result: Promise<{
          status: string;
          error?: unknown;
          suspended?: string[][];
          steps?: Record<string, { suspendPayload?: unknown } | undefined>;
        }>;
      };
    }>;
    deleteWorkflowRunById?(runId: string): Promise<void>;
  };
  plan: typeof StepAgents.planWithModel;
  writeAnswer: typeof StepAgents.writeAnswerWithModel;
}

/**
 * The real engine and step agents, required on first use: they keep the
 * workflow engine off the module graph of the eval sets' catalogue (which
 * Jest and the Agents screen load without running a case).
 */
function defaultParts(): WorkflowTargetParts {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { qtiV2TurnWorkflow } =
    require('../workflows/qti-v2-turn.workflow') as typeof TurnWorkflow;
  const { planWithModel, writeAnswerWithModel } =
    require('../workflows/qti-v2-turn.agents') as typeof StepAgents;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    workflow: qtiV2TurnWorkflow as unknown as WorkflowTargetParts['workflow'],
    plan: planWithModel,
    writeAnswer: writeAnswerWithModel,
  };
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

/** A clarifying question as the scored answer: the question, then each option. */
export function clarificationAnswer(asked: ClarifyingQuestion): string {
  return [asked.question, ...asked.options.map((option) => `- ${option}`)].join(
    '\n',
  );
}

/**
 * The question a suspended run waits on (ADR-0043): the suspend payload of
 * the top-level step on its first suspended path, else undefined.
 */
export function suspendedQuestionOf(outcome: {
  status: string;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown } | undefined>;
}): ClarifyingQuestion | undefined {
  if (outcome.status !== 'suspended') return undefined;
  const top = outcome.suspended?.[0]?.[0];
  return top
    ? clarifyingQuestionOf(outcome.steps?.[top]?.suspendPayload)
    : undefined;
}

/** The first valid `ask_clarification` call of an agent result's steps. */
function askedInResult(result: unknown): ClarifyingQuestion | undefined {
  const steps = (result as { steps?: unknown })?.steps;
  for (const step of Array.isArray(steps) ? steps : [result]) {
    const calls = (step as { toolCalls?: unknown })?.toolCalls;
    for (const call of Array.isArray(calls) ? calls : []) {
      const payload = ((call as { payload?: unknown })?.payload ?? call) as {
        toolName?: string;
        args?: unknown;
      };
      if (payload.toolName !== 'ask_clarification') continue;
      const asked = parseClarification(payload.args);
      if (!asked) continue;
      return {
        question: asked.question,
        options: asked.options.map((option) =>
          option.description
            ? `${option.label} — ${option.description}`
            : option.label,
        ),
      };
    }
  }
  return undefined;
}

type GenerateOptions = {
  context?: { role: 'system'; content: string }[];
  providerOptions?: Record<string, unknown>;
  requestContext?: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  onStepFinish?: (step: unknown) => unknown;
  [key: string]: unknown;
};

/**
 * The agent, its `generate` running the whole `qti-v2-turn` workflow
 * (above). Every other member is the agent's own.
 */
export function workflowTurnAgent(
  agent: Agent,
  given?: WorkflowTargetParts,
): Agent {
  let loaded = given;
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const parts = (loaded ??= defaultParts());
    const requestContext = options.requestContext;
    if (!requestContext) throw new Error('An eval case runs with a context');
    const datasets = requestContext.get(DATASETS_CONTEXT_KEY);
    const model = {
      ...(options.providerOptions
        ? { providerOptions: options.providerOptions }
        : {}),
      requestContext: requestContext as never,
    };
    let analysis: Record<string, unknown> | undefined;
    let answer = '';
    const runtime: QtiV2TurnRuntime = {
      plan: ({ question, catalogBlock }) =>
        parts.plan({ messages: input as never, question, catalogBlock }, model),
      analyse: async ({ catalogBlock, planBlock }) => {
        const records: ToolDataRecord[] = [];
        const result = (await agent.generate(
          input as never,
          {
            ...options,
            context: [
              ...(options.context ?? []),
              { role: 'system', content: catalogBlock },
              { role: 'system', content: planBlock },
            ],
            onStepFinish: (step: unknown) => {
              captureStepRecords(step, records);
              return options.onStepFinish?.(step);
            },
          } as never,
        )) as unknown as Record<string, unknown>;
        analysis = result;
        // The agent's question makes the step wait (the run is suspended).
        const asked = askedInResult(result);
        return {
          ...analyseAttemptOf(
            records,
            false,
            typeof result['text'] === 'string' ? result['text'] : '',
          ),
          ...(asked ? { clarification: asked } : {}),
        };
      },
      writeAnswer: async (written) => {
        const result = await parts.writeAnswer(written, model);
        answer = result.answer.answer;
        return result;
      },
    };
    requestContext.set(QTI_V2_TURN_RUNTIME_KEY, runtime);
    const created = await parts.workflow.createRun();
    const run = created.stream({
      inputData: {
        question: lastUserText(input).trim(),
        datasets: Array.isArray(datasets) ? datasets : [],
      },
      requestContext,
    });
    for await (const event of run.fullStream) void event;
    const outcome = await run.result;
    if (outcome.status === 'failed') {
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error('The Questions to Insights v2 run failed');
    }
    // A run waiting on a clarifying question is scored on it, then dropped.
    const clarified = suspendedQuestionOf(outcome);
    if (outcome.status === 'suspended' && created.runId) {
      await parts.workflow.deleteWorkflowRunById?.(created.runId);
    }
    return {
      // No Analyse ran when Plan clarified: no tool call to score.
      ...(analysis ?? {
        steps: [],
        toolCalls: [],
        toolResults: [],
        scoringData: { input, output: [] },
      }),
      text: clarified ? clarificationAnswer(clarified) : answer,
    };
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
