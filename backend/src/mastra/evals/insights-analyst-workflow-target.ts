import type { Agent } from '@mastra/core/agent';
import type * as StepAgents from '../workflows/answer-business-question.agents';
import type * as TurnWorkflow from '../workflows/answer-business-question.workflow';
import {
  ANALYSE_RETRY_MAX_STEPS,
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  clarifyingQuestionOf,
  type ClarifyingQuestion,
  type AnswerBusinessQuestionRuntime,
} from '../workflows/answer-business-question.steps';
import { analyseSystemBlocks } from '../workflows/answer-business-question.prompts';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { parseClarification } from '../tools/clarification.tool';
import { analyseAttemptOf } from '../../modules/sessions/turn/turn-workflow';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import { captureStepRecords, type EvalCustomCheck } from './assistant.evals';
import {
  EVAL_DETAILS_KEY,
  recordStepOutput,
  type EvalRunDetails,
} from './eval-details';

/**
 * The `insights-analyst` eval target's turn (agents.md 8.1): every case runs the
 * WHOLE `answer-business-question` workflow, as a run does (5.11), not the agent alone.
 * `runEvals` calls the agent's `generate`; this target is the agent with
 * `generate` replaced by one run of the workflow, whose:
 * - Plan and Write answer steps call the model as a run's do;
 * - Analyse step is the agent's own `generate` with the case's options (its
 *   orientation, knowledge, step budget and scorer data) plus the turn
 *   engine's blocks (the catalog with its columns, the plan and, on a retry,
 *   the earlier queries; the retry's step budget is
 *   `ANALYSE_RETRY_MAX_STEPS`), so the scorers and checks read Analyse's
 *   tool calls and results (both attempts', when Validate made it retry);
 *   a retry whose `generate` throws keeps attempt 1, as a run does;
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
  const { answerBusinessQuestionWorkflow } =
    require('../workflows/answer-business-question.workflow') as typeof TurnWorkflow;
  const { planWithModel, writeAnswerWithModel } =
    require('../workflows/answer-business-question.agents') as typeof StepAgents;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    workflow:
      answerBusinessQuestionWorkflow as unknown as WorkflowTargetParts['workflow'],
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

/**
 * The run details' key (in `steps`, beside the step outputs) of each Analyse
 * attempt's tool names, in call order: `[attempt 1's, attempt 2's]`.
 */
export const ANALYSE_ATTEMPTS_KEY = 'analyse-attempts';

/**
 * The retry case's check (agents.md 8.1, 5.11): after a retry, the retry
 * itself called neither `list_entities` nor `describe_entity` (its request
 * lists attempt 1's queries and the columns of each entity), read from
 * `ANALYSE_ATTEMPTS_KEY`. A run that did not retry passes.
 */
export function retryDoesNotRediscover(): EvalCustomCheck {
  return {
    id: 'retry-no-rediscovery',
    description: 'The retry of Analyse lists and describes no entity again',
    run: ({ details }) => {
      const attempts = details?.steps?.[ANALYSE_ATTEMPTS_KEY];
      if (!Array.isArray(attempts) || attempts.length < 2) return undefined;
      const again = arrayOf(attempts[1]).filter(
        (tool) => tool === 'list_entities' || tool === 'describe_entity',
      );
      return again.length
        ? `the retry called ${again.join(', ')} again`
        : undefined;
    },
  };
}

/** A result field as an array (`[]` when absent). */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Two Analyse attempts' agent results as one (agents.md 8.1): the later
 * attempt's own fields, with the steps, tool calls, tool results and
 * scoring output of both, the earlier attempt's first.
 */
function joinAttempts(
  earlier: Record<string, unknown>,
  later: Record<string, unknown>,
): Record<string, unknown> {
  const join = (key: string) => [
    ...arrayOf(earlier[key]),
    ...arrayOf(later[key]),
  ];
  type Scoring = { output?: unknown } | undefined;
  const earlierScoring = earlier['scoringData'] as Scoring;
  const laterScoring = later['scoringData'] as Scoring;
  return {
    ...later,
    steps: join('steps'),
    toolCalls: join('toolCalls'),
    toolResults: join('toolResults'),
    ...(earlierScoring || laterScoring
      ? {
          scoringData: {
            ...earlierScoring,
            ...laterScoring,
            output: [
              ...arrayOf(earlierScoring?.output),
              ...arrayOf(laterScoring?.output),
            ],
          },
        }
      : {}),
  };
}

/** The tool names an agent result called, in order, across its steps. */
function toolNamesOf(result: unknown): string[] {
  const steps = (result as { steps?: unknown })?.steps;
  return arrayOf(steps).flatMap((step) =>
    arrayOf((step as { toolCalls?: unknown })?.toolCalls).map((call) => {
      const payload = ((call as { payload?: unknown })?.payload ?? call) as {
        toolName?: unknown;
      };
      return typeof payload.toolName === 'string' ? payload.toolName : 'tool';
    }),
  );
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
 * The agent, its `generate` running the whole `answer-business-question` workflow
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
    // Each attempt's tool names, for the checks (`analyse-attempts`).
    const attemptTools: string[][] = [];
    // Every case is a single-turn first question: the runtime holds no
    // earlier queries (`followUp`), so Interpret follow-up makes no model
    // call and the run takes the question path (roadmap 1.28.8).
    const runtime: AnswerBusinessQuestionRuntime = {
      plan: ({ question, catalogBlock }) =>
        parts.plan({ messages: input as never, question, catalogBlock }, model),
      analyse: async ({
        catalogBlock,
        planBlock,
        earlierBlock,
        attempt,
        imageNotes,
      }) => {
        const records: ToolDataRecord[] = [];
        let result: Record<string, unknown>;
        try {
          result = (await agent.generate(
            input as never,
            {
              ...options,
              // A retry's own step budget, as the turn engine's.
              ...(attempt > 1 ? { maxSteps: ANALYSE_RETRY_MAX_STEPS } : {}),
              // The turn engine's blocks: the catalog with its columns,
              // the plan, the earlier queries on a retry (agents.md 5.11).
              context: [
                ...(options.context ?? []),
                ...analyseSystemBlocks({
                  catalogBlock,
                  planBlock,
                  earlierBlock,
                  imageNotes,
                }).map((content) => ({ role: 'system' as const, content })),
              ],
              onStepFinish: (step: unknown) => {
                captureStepRecords(step, records);
                return options.onStepFinish?.(step);
              },
            } as never,
          )) as Record<string, unknown>;
        } catch (error) {
          // `generate` throws on a model error: a retry's keeps attempt 1,
          // as the turn engine's does; attempt 1's fails the case.
          if (attempt <= 1) throw error;
          attemptTools.push(records.map((record) => record.tool));
          return {
            ...analyseAttemptOf(records, false, ''),
            retryError: error instanceof Error ? error.message : String(error),
          };
        }
        attemptTools.push(toolNamesOf(result));
        // The scorers, the checks and the judge read the tool calls and
        // results of every attempt: the runner's trace is `steps`
        // (extractRawToolCalls), the judge's `scoringData.output`.
        analysis = analysis ? joinAttempts(analysis, result) : result;
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
    requestContext.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, runtime);
    const created = await parts.workflow.createRun();
    const run = created.stream({
      inputData: {
        question: lastUserText(input).trim(),
        datasets: Array.isArray(datasets) ? datasets : [],
      },
      requestContext,
    });
    const steps: Record<string, unknown> = {};
    for await (const event of run.fullStream) recordStepOutput(event, steps);
    // Not a step: each Analyse attempt's tool names, in order, so a check
    // can tell what the retry itself called.
    if (attemptTools.length) steps[ANALYSE_ATTEMPTS_KEY] = attemptTools;
    const outcome = await run.result;
    if (outcome.status === 'failed') {
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error('The Answer a Business Question run failed');
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
      [EVAL_DETAILS_KEY]: { steps } satisfies EvalRunDetails,
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
