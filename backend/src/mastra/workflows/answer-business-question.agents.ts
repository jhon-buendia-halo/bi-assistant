/**
 * The model calls of the two tool-less steps of Insights Analyst
 * (agents.md 5.11): Plan and Write answer. Each runs a registered System
 * agent (Olivia, `analysis-planner`; Jessica, `answer-writer`; agents.md
 * 1.1, 2.11) on v2's model (`resolveAgentModel`), with its own editable
 * instructions, no tools, no memory and structured output by JSON prompt
 * injection, so any provider answers it (a native response format is not
 * required). The session's turn and the eval runner call them through
 * `AnswerBusinessQuestionRuntime`.
 */
import type { MessageListInput } from '@mastra/core/agent/message-list';
import type { RequestContext } from '@mastra/core/request-context';
import { analysisPlannerAgent } from '../agents/analysis-planner.agent';
import { answerWriterAgent } from '../agents/answer-writer.agent';
import { dataReadinessStepAgent } from '../agents/data-readiness.agent';
import {
  dataQualityRequest,
  planMessages,
  writeAnswerRequest,
} from './answer-business-question.prompts';
import {
  answerSchema,
  dataQualityReplySchema,
  planSchema,
} from './answer-business-question.schemas';
import type { AgentExchange } from '../agent-threads';
import { runErrorMessage } from './workflow-run';
import {
  answerOf,
  jsonObjectOf,
  planOf,
  type AnalyseQuery,
  type AnsweredClarification,
  type BusinessAnswer,
  type AnalysisPlan,
  type ValidationFinding,
} from './answer-business-question.steps';

/** The agents of the two calls (agents.md 1.1): Olivia plans, Jessica writes. */
const planAgent = analysisPlannerAgent;
const writeAnswerAgent = answerWriterAgent;

/** What both calls share with the turn: its stop, effort and context. */
export interface StepModelOptions {
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
  requestContext?: RequestContext;
  /**
   * Called once the agent replied (never on a stop or a failure) with the
   * request it got and its reply, so the run records the exchange in the
   * agent's thread (agents.md 5.14). The call itself has no memory.
   */
  onExchange?: (exchange: AgentExchange) => void | Promise<void>;
}

/** The text of a request: the message the call ends with. */
function requestText(messages: unknown): string {
  if (typeof messages === 'string') return messages;
  const last = Array.isArray(messages)
    ? (messages.at(-1) as { content?: unknown } | undefined)
    : undefined;
  const content = last?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

/** The text of a reply: the model's text, else its object as JSON. */
export function replyText(object: unknown, text: string | undefined): string {
  if (text?.trim()) return text;
  return object === undefined ? '' : JSON.stringify(object);
}

/** Hand the exchange to `onExchange` unless the turn stopped. */
export async function noteExchange(
  options: StepModelOptions,
  request: string,
  reply: string,
): Promise<void> {
  if (stoppedBy(options) || !options.onExchange) return;
  await options.onExchange({ request, reply });
}

/** One model call, no tools, structured output by JSON prompt injection. */
export function callOptions(options: StepModelOptions) {
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
export function stoppedBy(options: StepModelOptions): boolean {
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
): Promise<{ plan: AnalysisPlan; stopped: boolean }> {
  // The conversation before the question, then the question with the
  // catalog (after Clarify: the question, Plan's question and the answer).
  const planned = planMessages(input);
  const messages = planned.messages as MessageListInput;
  try {
    const result = await planAgent.generate(messages, {
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
    await noteExchange(
      options,
      requestText(planned.messages),
      replyText(reply.object, reply.text),
    );
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

/** Sarah's reply read as issues: the well-formed ones, in order. */
function issuesOf(reply: unknown): { finding: number; impact: string }[] {
  const parsed = dataQualityReplySchema.safeParse(jsonObjectOf(reply));
  return parsed.success
    ? parsed.data.issues.filter(
        (issue) => Number.isInteger(issue.finding) && issue.impact.trim(),
      )
    : [];
}

/**
 * The Check data quality step's model call (agents.md 5.11): Sarah, the
 * Data Readiness Agent, with her own instructions, no tools and one model
 * call, picks the engine findings that affect the answer. A reply that is
 * no JSON object picks none. A stopped turn picks nothing.
 */
export async function checkDataQualityWithModel(
  input: Parameters<typeof dataQualityRequest>[0],
  options: StepModelOptions,
): Promise<{
  issues: { finding: number; impact: string }[];
  stopped: boolean;
}> {
  const request = dataQualityRequest(input);
  try {
    const result = await dataReadinessStepAgent.generate(request, {
      ...callOptions(options),
      structuredOutput: {
        schema: dataQualityReplySchema,
        jsonPromptInjection: 'inline',
        errorStrategy: 'warn',
      },
    });
    const reply = result as {
      object?: unknown;
      text?: string;
      error?: unknown;
    };
    if (reply.error !== undefined && !stoppedBy(options)) {
      throw reply.error instanceof Error
        ? reply.error
        : new Error(runErrorMessage(reply.error));
    }
    await noteExchange(options, request, replyText(reply.object, reply.text));
    return {
      issues: stoppedBy(options) ? [] : issuesOf(reply.object ?? reply.text),
      stopped: stoppedBy(options),
    };
  } catch (error) {
    if (stoppedBy(options)) return { issues: [], stopped: true };
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
    plan: AnalysisPlan;
    queries: readonly AnalyseQuery[];
    findings: readonly ValidationFinding[];
  },
  options: StepModelOptions & { onText?: (delta: string) => void },
): Promise<{ answer: BusinessAnswer; stopped: boolean }> {
  let sent = '';
  const send = (full: string) => {
    if (!options.onText || !full.startsWith(sent) || full === sent) return;
    options.onText(full.slice(sent.length));
    sent = full;
  };
  const request = writeAnswerRequest(input);
  try {
    const stream = await writeAnswerAgent.stream(request, {
      ...callOptions(options),
      structuredOutput: {
        schema: answerSchema,
        jsonPromptInjection: 'inline',
        // A reply that is no JSON object is the answer text (`answerOf`).
        errorStrategy: 'warn',
      },
    });
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
    await noteExchange(options, request, replyText(object, text));
    return { answer, stopped: stoppedBy(options) };
  } catch (error) {
    if (stoppedBy(options)) {
      return { answer: answerOf(sent), stopped: true };
    }
    throw error;
  }
}
