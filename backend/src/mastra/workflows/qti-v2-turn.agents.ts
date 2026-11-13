/**
 * The model calls of the two tool-less steps of Questions to Insights v2
 * (agents.md 5.11): Plan and Write answer. Each runs a registered System
 * agent (Olivia, `analysis-planner`; Jessica, `answer-writer`; agents.md
 * 1.1, 2.11) on v2's model (`resolveAgentModel`), with its own editable
 * instructions, no tools, no memory and structured output by JSON prompt
 * injection, so any provider answers it (a native response format is not
 * required). The session's turn and the eval runner call them through
 * `QtiV2TurnRuntime`.
 */
import type { MessageListInput } from '@mastra/core/agent/message-list';
import type { RequestContext } from '@mastra/core/request-context';
import { analysisPlannerAgent } from '../agents/analysis-planner.agent';
import { answerWriterAgent } from '../agents/answer-writer.agent';
import { planMessages, writeAnswerRequest } from './qti-v2-turn.prompts';
import { answerSchema, planSchema } from './qti-v2-turn.schemas';
import { runErrorMessage } from './workflow-run';
import {
  answerOf,
  planOf,
  type AnalyseQuery,
  type AnsweredClarification,
  type QtiV2Answer,
  type QtiV2Plan,
  type ValidationFinding,
} from './qti-v2-turn.steps';

/** The agents of the two calls (agents.md 1.1): Olivia plans, Jessica writes. */
const qtiV2PlanAgent = analysisPlannerAgent;
const qtiV2WriteAnswerAgent = answerWriterAgent;

/** What both calls share with the turn: its stop, effort and context. */
export interface StepModelOptions {
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
  requestContext?: RequestContext;
}

/** One model call, no tools, structured output by JSON prompt injection. */
function callOptions(options: StepModelOptions) {
  return {
    maxSteps: 1,
    toolChoice: 'none' as const,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    ...(options.providerOptions
      ? { providerOptions: options.providerOptions as never }
      : {}),
    ...(options.requestContext
      ? { requestContext: options.requestContext }
      : {}),
  };
}

/** Whether a failure is the turn's own stop. */
function stoppedBy(options: StepModelOptions): boolean {
  return options.abortSignal?.aborted === true;
}

/**
 * The Plan step's call (agents.md 5.11): the turn's input messages (the
 * question, or the transcript it ends with) with the catalog block, and
 * the plan read from the reply (`planOf`). A stopped turn plans nothing.
 */
export async function planWithModel(
  input: {
    messages: MessageListInput | undefined;
    question: string;
    catalogBlock: string;
    /** After Clarify: its question and the user's answer (ADR-0043). */
    answered?: AnsweredClarification;
  },
  options: StepModelOptions,
): Promise<{ plan: QtiV2Plan; stopped: boolean }> {
  // The conversation before the question, then the question with the
  // catalog (after Clarify: the question, Plan's question and the answer).
  const planned = planMessages(input);
  const messages = planned.messages as MessageListInput;
  try {
    const result = await qtiV2PlanAgent.generate(messages, {
      ...callOptions(options),
      structuredOutput: {
        schema: planSchema,
        jsonPromptInjection: 'inline',
        // A reply that is no plan is read leniently (`planOf`), not refused.
        errorStrategy: 'warn',
      },
    });
    const reply = result as {
      object?: unknown;
      text?: string;
      error?: unknown;
    };
    // The model's own failure fails the step (agents.md 5.11).
    if (reply.error !== undefined && !stoppedBy(options)) {
      throw reply.error instanceof Error
        ? reply.error
        : new Error(runErrorMessage(reply.error));
    }
    return {
      plan: planOf(reply.object ?? reply.text, planned.fallback),
      stopped: stoppedBy(options),
    };
  } catch (error) {
    if (stoppedBy(options)) {
      return { plan: planOf(undefined, planned.fallback), stopped: true };
    }
    throw error;
  }
}

/** The answer text in a partial JSON object streamed so far, if any. */
function partialAnswer(partial: unknown): string {
  const answer = (partial as { answer?: unknown } | undefined)?.answer;
  return typeof answer === 'string' ? answer : '';
}

/**
 * The Write answer step's call (agents.md 5.11): the answer read from the
 * reply (`answerOf`). With `onText`, the answer's Markdown streams as it is
 * written (each new piece of the partial object's `answer`); whatever the
 * stream did not deliver is sent once the reply is complete, so `onText`
 * always receives the whole answer exactly once.
 */
export async function writeAnswerWithModel(
  input: {
    question: string;
    plan: QtiV2Plan;
    queries: readonly AnalyseQuery[];
    findings: readonly ValidationFinding[];
  },
  options: StepModelOptions & { onText?: (delta: string) => void },
): Promise<{ answer: QtiV2Answer; stopped: boolean }> {
  let sent = '';
  const send = (full: string) => {
    if (!options.onText || !full.startsWith(sent) || full === sent) return;
    options.onText(full.slice(sent.length));
    sent = full;
  };
  try {
    const stream = await qtiV2WriteAnswerAgent.stream(
      writeAnswerRequest(input),
      {
        ...callOptions(options),
        structuredOutput: {
          schema: answerSchema,
          jsonPromptInjection: 'inline',
          // A reply that is no JSON object is the answer text (`answerOf`).
          errorStrategy: 'warn',
        },
      },
    );
    if (options.onText) {
      for await (const partial of stream.objectStream as AsyncIterable<unknown>) {
        send(partialAnswer(partial));
      }
    }
    let object: unknown;
    try {
      object = await stream.object;
    } catch {
      // A reply that is no JSON object is read as the answer text below.
    }
    const text = await stream.text;
    // The model's own failure fails the step (agents.md 5.11).
    if (stream.error && !stoppedBy(options)) throw stream.error;
    const answer = answerOf(object ?? text);
    send(answer.answer);
    return { answer, stopped: stoppedBy(options) };
  } catch (error) {
    if (stoppedBy(options)) {
      return { answer: answerOf(sent), stopped: true };
    }
    throw error;
  }
}
