/**
 * The model calls of the two tool-less steps of Insights Analyst
 * (agents.md 5.11): Plan and Write answer. Each runs a registered System
 * agent (Olivia, `analysis-planner`; Jessica, `answer-writer`; agents.md
 * 1.1, 2.11) on v2's model (`resolveAgentModel`), with its own editable
 * instructions, no tools, no memory and structured output by JSON prompt
 * injection, so any provider answers it (a native response format is not
 * required). The session's turn and the eval runner call them through
 * `AnswerBusinessQuestionRuntime`. The shared-context experiment's variants
 * (`planWithSharedContext`, `writeAnswerWithSharedContext`) are the same
 * calls with a short index of the run's board and its two read tools.
 */
import type { MessageListInput } from '@mastra/core/agent/message-list';
import type { RequestContext } from '@mastra/core/request-context';
import { analysisPlannerAgent } from '../agents/analysis-planner.agent';
import { answerWriterAgent } from '../agents/answer-writer.agent';
import {
  planMessages,
  writeAnswerRequest,
  type PlanMessage,
} from './answer-business-question.prompts';
import {
  SHARED_CONTEXT_MAX_STEPS,
  sharedPlanMessages,
  sharedWriteAnswerRequest,
} from './answer-business-question-shared.prompts';
import { answerSchema, planSchema } from './answer-business-question.schemas';
import { RUN_CONTEXT_TOOLS } from '../tools/run-context.tools';
import { runContextOf, type RunContextBoard } from './run-context';
import type { AgentExchange } from '../agent-threads';
import { runErrorMessage } from './workflow-run';
import { cutReply, guardedCall, ReplyCutError } from './model-call';
import {
  answerDeltas,
  answerOf,
  answerWithRowTables,
  planOf,
  type AnalyseQuery,
  type AnsweredClarification,
  type BusinessAnswer,
  type AnalysisPlan,
  type CatalogEntity,
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
  /**
   * One line per retry of the call (workflows R43), which the turn shows as
   * a reasoning line of the running step.
   */
  onRetry?: (line: string) => void;
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

/**
 * A shared-context call (the run context experiment, ./run-context.ts): the
 * same call with the board's two read tools and a short tool loop. The
 * final step's text is still the JSON the structured output reads.
 */
export function sharedCallOptions(options: StepModelOptions) {
  return {
    ...callOptions(options),
    maxSteps: SHARED_CONTEXT_MAX_STEPS,
    toolChoice: 'auto' as const,
    toolsets: { runContext: RUN_CONTEXT_TOOLS },
    prepareStep: sharedPrepareStep,
  };
}

/**
 * The shared tool loop's last step runs without tools, so the loop always
 * ends with the final JSON instead of one more read (the experiment's first
 * rounds lost answers to Write answer reading until it ran out of steps).
 */
export function sharedPrepareStep({
  stepNumber,
}: {
  stepNumber: number;
}): { toolChoice: 'none' } | undefined {
  return stepNumber >= SHARED_CONTEXT_MAX_STEPS - 1
    ? { toolChoice: 'none' }
    : undefined;
}

/** How a call's options are made: the baseline's or the shared ones. */
type CallOptionsOf = typeof callOptions | typeof sharedCallOptions;

/**
 * Whether a shared-context reply is cut: at the output cap, or when the
 * tool loop ran out of steps right after a tool call (`tool-calls`, no
 * final JSON). Either is retried once, then fails the step, instead of
 * being read as an empty plan or answer.
 */
export function sharedCutReply(finishReason: unknown): boolean {
  return cutReply(finishReason) || finishReason === 'tool-calls';
}

/**
 * The tools read the board from the call's RequestContext: a shared call
 * runs only when it holds the board its request indexes.
 */
function requireBoard(options: StepModelOptions, board: RunContextBoard) {
  const held = options.requestContext
    ? runContextOf(options.requestContext)
    : undefined;
  if (held !== board) throw new Error('The run context is missing');
}

/** Whether a failure is the turn's own stop. */
export function stoppedBy(options: StepModelOptions): boolean {
  return options.abortSignal?.aborted === true;
}

/**
 * The Plan step's call (agents.md 5.11): the turn's input messages (the
 * question, or the transcript it ends with) with the catalog block, and
 * the plan read from the reply (`planOf`). A stopped turn plans nothing.
 * The call is guarded (`guardedCall`, workflows R43): a deadline, and one
 * retry of a transient failure or of a reply cut at the output cap; cut
 * twice, the step fails with `ReplyCutError`.
 */
export async function planWithModel(
  input: {
    messages: MessageListInput | undefined;
    question: string;
    catalogBlock: string;
    /** After Clarify: its question and the user's answer (ADR-0043). */
    answered?: AnsweredClarification;
    /**
     * Read images' notes (agents.md 2.15, 5.11): they end the request when
     * not empty; absent or `''`, the request is what it was before.
     */
    imageNotes?: string;
  },
  options: StepModelOptions,
): Promise<{ plan: AnalysisPlan; stopped: boolean }> {
  // The conversation before the question, then the question with the
  // catalog (after Clarify: the question, Plan's question and the answer).
  return planFrom(planMessages(input), options, callOptions);
}

/**
 * The Plan step's call in the shared-context experiment: `planWithModel`
 * with the catalog's index and the board's read tools (`sharedCallOptions`)
 * in place of the catalog with its columns and image notes. The call's
 * RequestContext must hold `board`.
 */
export async function planWithSharedContext(
  input: {
    messages: MessageListInput | undefined;
    question: string;
    catalog: readonly CatalogEntity[];
    board: RunContextBoard;
    /** After Clarify: its question and the user's answer (ADR-0043). */
    answered?: AnsweredClarification;
  },
  options: StepModelOptions,
): Promise<{ plan: AnalysisPlan; stopped: boolean }> {
  requireBoard(options, input.board);
  return planFrom(
    sharedPlanMessages(input),
    options,
    sharedCallOptions,
    sharedCutReply,
  );
}

/** Plan's guarded call on its messages, the plan read from the reply. */
async function planFrom(
  planned: { messages: string | PlanMessage[]; fallback: string },
  options: StepModelOptions,
  optionsOf: CallOptionsOf,
  isCut: (finishReason: unknown) => boolean = cutReply,
): Promise<{ plan: AnalysisPlan; stopped: boolean }> {
  const messages = planned.messages as MessageListInput;
  try {
    return await guardedCall(options, { label: 'Plan' }, async (call) => {
      const result = await planAgent.generate(messages, {
        ...optionsOf(call),
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
        finishReason?: unknown;
      };
      // The model's own failure fails the step (agents.md 5.11).
      if (reply.error !== undefined && !stoppedBy(call)) {
        throw reply.error instanceof Error
          ? reply.error
          : new Error(runErrorMessage(reply.error));
      }
      // A reply cut at the output cap is no plan read leniently.
      if (!stoppedBy(call) && isCut(reply.finishReason)) {
        throw new ReplyCutError('Plan');
      }
      await noteExchange(
        call,
        requestText(planned.messages),
        replyText(reply.object, reply.text),
      );
      return {
        plan: planOf(reply.object ?? reply.text, planned.fallback),
        stopped: stoppedBy(call),
      };
    });
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

/** The headline in a partial JSON object streamed so far, if any. */
function partialHeadline(partial: unknown): string {
  const headline = (partial as { headline?: unknown } | undefined)?.headline;
  return typeof headline === 'string' ? headline.trim() : '';
}

/** A stream's finish reason; undefined when it has none or it failed. */
async function finishReasonOf(stream: unknown): Promise<unknown> {
  try {
    return await (stream as { finishReason?: unknown }).finishReason;
  } catch {
    return undefined;
  }
}

/** The line Write answer adds when its reply was cut after text was shown. */
export const ANSWER_CUT_NOTE = 'The answer was cut at the output limit.';

/** What puts `ANSWER_CUT_NOTE` after a blank line, the shown text kept as it is. */
function cutNoteGap(shown: string): string {
  if (shown.endsWith('\n\n')) return '';
  return shown.endsWith('\n') ? '\n' : '\n\n';
}

/**
 * The Write answer step's call (agents.md 5.11): the answer read from the
 * reply (`answerOf`), its row markers expanded into tables of the queries'
 * rows (`answerWithRowTables`, plan 1.25.6). With `onText`, the answer's
 * Markdown streams as it is written (each new piece of the partial object's
 * `answer`, markers expanded or held back by `answerDeltas`); whatever the
 * stream did not deliver is sent once the reply is complete, so `onText`
 * always receives the whole answer exactly once and never a marker. The
 * call is guarded (`guardedCall`, workflows R43) and retried only while
 * nothing was shown; a reply cut at the output cap after text was shown
 * keeps that text, adds `ANSWER_CUT_NOTE` and succeeds.
 */
export async function writeAnswerWithModel(
  input: {
    question: string;
    plan: AnalysisPlan;
    queries: readonly AnalyseQuery[];
    findings: readonly ValidationFinding[];
    /**
     * Read images' notes (agents.md 2.15, 5.11): they follow the plan when
     * not empty; absent or `''`, the request is what it was before.
     */
    imageNotes?: string;
    /**
     * Build visual runs after it and the request cues a visual: the
     * request ends with the line saying so; absent, it is as before.
     */
    visualFollows?: boolean;
  },
  options: StepModelOptions & { onText?: (delta: string) => void },
): Promise<{ answer: BusinessAnswer; stopped: boolean }> {
  return writeAnswerFrom(
    writeAnswerRequest(input),
    input.queries,
    options,
    callOptions,
  );
}

/**
 * The Write answer step's call in the shared-context experiment:
 * `writeAnswerWithModel` with a query index and the board's read tools
 * (`sharedCallOptions`) in place of the queries' rows and image notes. The
 * markers still expand from `queries`' rows. The call's RequestContext must
 * hold `board`.
 */
export async function writeAnswerWithSharedContext(
  input: {
    question: string;
    plan: AnalysisPlan;
    queries: readonly AnalyseQuery[];
    findings: readonly ValidationFinding[];
    board: RunContextBoard;
    /** Build visual runs after it and the request cues a visual. */
    visualFollows?: boolean;
  },
  options: StepModelOptions & { onText?: (delta: string) => void },
): Promise<{ answer: BusinessAnswer; stopped: boolean }> {
  requireBoard(options, input.board);
  return writeAnswerFrom(
    sharedWriteAnswerRequest(input),
    input.queries,
    options,
    sharedCallOptions,
    sharedCutReply,
  );
}

/** Write answer's guarded, streamed call on its request. */
async function writeAnswerFrom(
  request: string,
  queries: readonly AnalyseQuery[],
  options: StepModelOptions & { onText?: (delta: string) => void },
  optionsOf: CallOptionsOf,
  isCut: (finishReason: unknown) => boolean = cutReply,
): Promise<{ answer: BusinessAnswer; stopped: boolean }> {
  const deltas = answerDeltas(queries, options.onText);
  try {
    // Retried only while nothing was shown: a retry never repeats text.
    const guard = { label: 'Write answer', canRetry: () => !deltas.sent() };
    return await guardedCall(options, guard, async (call) => {
      // The try's deadline fired while the run goes on: the step has failed
      // already (`guardedCall`), so the aborted stream's rest is not shown.
      const expired = () => stoppedBy(call) && !stoppedBy(options);
      const stream = await writeAnswerAgent.stream(request, {
        ...optionsOf(call),
        structuredOutput: {
          schema: answerSchema,
          jsonPromptInjection: 'inline',
          // A reply that is no JSON object is the answer text (`answerOf`).
          errorStrategy: 'warn',
        },
      });
      let headline = '';
      if (options.onText) {
        for await (const partial of stream.objectStream as AsyncIterable<unknown>) {
          if (expired()) break;
          deltas.update(partialAnswer(partial));
          headline = partialHeadline(partial) || headline;
        }
      }
      let object: unknown;
      try {
        object = await stream.object;
      } catch {
        // A reply that is no JSON object is read as the answer text below.
      }
      const text = await stream.text;
      // Its result is never read: the step failed with the timeout.
      if (expired()) return { answer: answerOf(deltas.sent()), stopped: false };
      // The model's own failure fails the step (agents.md 5.11).
      if (stream.error && !stoppedBy(call)) throw stream.error;
      if (!stoppedBy(call) && isCut(await finishReasonOf(stream))) {
        // Cut before anything was shown: tried once more, then a failure.
        if (!deltas.sent()) throw new ReplyCutError('Write answer');
        // Cut after text was shown: the text stays as it was shown, so the
        // note streams too, and the note follows it after a blank line.
        const sent = deltas.sent();
        const answer = {
          headline: headline || answerOf(sent).headline,
          answer: `${sent}${cutNoteGap(sent)}${ANSWER_CUT_NOTE}`,
        };
        deltas.finish(answer.answer);
        await noteExchange(call, request, replyText(object, text));
        return { answer, stopped: false };
      }
      const answer = answerWithRowTables(answerOf(object ?? text), queries);
      deltas.finish(answer.answer);
      await noteExchange(call, request, replyText(object, text));
      return { answer, stopped: stoppedBy(call) };
    });
  } catch (error) {
    if (stoppedBy(options)) {
      // What was shown, markers already expanded or held back.
      return { answer: answerOf(deltas.sent()), stopped: true };
    }
    throw error;
  }
}
