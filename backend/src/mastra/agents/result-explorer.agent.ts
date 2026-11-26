import type { ResultView } from '../../modules/datasources/connectors/paged-sql.types';
import type { AgentExchange } from '../agent-threads';
import { runErrorMessage } from '../workflows/workflow-run';
import { guardedCall } from '../workflows/model-call';
import type { RequestContext } from '@mastra/core/request-context';
import { RESULT_EXPLORER_AGENT_KEY } from '../agent-constants';
import { defineBuiltinAgent } from '../agent-factory';
import {
  explorerRequest,
  RESULT_EXPLORER_INSTRUCTIONS,
  RESULT_EXPLORER_REPLY_SCHEMA,
  specOf,
  type ExplorerCandidate,
  type ExplorerSpec,
} from './result-explorer.prompts';

/**
 * Nathan, Result Explorer (agents.md 1.1, 2.17): turns a user's words into a
 * view (filters, sort, page) of a stored query's result, over its known
 * columns only, in one model call with no tools and no memory. A System
 * agent: the query inspector's filter in words (api.md 153, 155) calls him
 * through `interpretResultWithModel`; his job description is the shipped
 * instructions or their in-app override (ADR-0026).
 */
export const resultExplorerAgent = defineBuiltinAgent({
  key: RESULT_EXPLORER_AGENT_KEY,
  name: 'Result Explorer',
  description:
    "Turns a user's words into filters, a sort and a page over a query's result columns. No tools, no SQL.",
  classes: ['single-step'],
  instructions: RESULT_EXPLORER_INSTRUCTIONS,
  // A workflow may run its step agents on its own model (agents.md 1.3).
  model: 'step-model',
});

/** What the explorer reads: the words, the candidates and the current view. */
export interface InterpretResultInput {
  text: string;
  candidates: ExplorerCandidate[];
  /** The view the user sees now; null for the answer's stored rows. */
  view: ResultView | null;
  /** The current view's page count; null when unknown. */
  pageCount: number | null;
}

/**
 * The model call (api.md 153, 155): the request holds no SQL and no whole
 * rows. A model
 * error, or a reply that is no JSON object, throws; the reply is read by
 * `specOf`. `onExchange` gets the request and the reply once the agent
 * replied (a run records it in Nathan's thread, agents.md 5.14). The call
 * has a five-minute deadline (`guardedCall`, workflows R43), past which it
 * fails with `ModelTimeoutError`; it is not retried.
 */
export async function interpretResultWithModel(
  input: InterpretResultInput,
  options: {
    abortSignal?: AbortSignal;
    onExchange?: (exchange: AgentExchange) => void | Promise<void>;
    /** A workflow run's turn options: its model's effort and context. */
    providerOptions?: Record<string, unknown>;
    requestContext?: RequestContext;
  } = {},
): Promise<ExplorerSpec> {
  const request = explorerRequest(
    input.text,
    input.candidates,
    input.view,
    input.pageCount,
  );
  // A deadline only (workflows R43): no retry of a failure or a cut reply.
  const guard = { label: 'Result Explorer', canRetry: () => false };
  const result = await guardedCall(
    options,
    guard,
    async (call) =>
      (await resultExplorerAgent.generate(request, {
        maxSteps: 1,
        toolChoice: 'none',
        ...(call.abortSignal ? { abortSignal: call.abortSignal } : {}),
        ...(options.providerOptions
          ? { providerOptions: options.providerOptions as never }
          : {}),
        ...(options.requestContext
          ? { requestContext: options.requestContext }
          : {}),
        structuredOutput: {
          schema: RESULT_EXPLORER_REPLY_SCHEMA,
          jsonPromptInjection: 'inline',
          errorStrategy: 'warn',
        },
      })) as { object?: unknown; text?: string; error?: unknown },
  );
  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new Error(runErrorMessage(result.error));
  }
  const spec = specOf(
    result.object ?? result.text,
    input.candidates,
    input.view,
    input.pageCount,
  );
  if (options.onExchange && !options.abortSignal?.aborted) {
    await options.onExchange({
      request,
      reply: result.text?.trim()
        ? result.text
        : JSON.stringify(result.object ?? null),
    });
  }
  return spec;
}
