import { Agent } from '@mastra/core/agent';
import type { ResultView } from '../../modules/datasources/connectors/paged-sql.types';
import { runErrorMessage } from '../workflows/workflow-run';
import { agentInstructions } from '../agent-prompt-overrides';
import { RESULT_EXPLORER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import {
  explorerRequest,
  RESULT_EXPLORER_INSTRUCTIONS,
  RESULT_EXPLORER_REPLY_SCHEMA,
  specOf,
  type ExplorerCandidate,
  type ExplorerSpec,
} from './result-explorer.prompts';

/**
 * Nathan, Result Explorer (agents.md 1.1, 2.15): turns a user's words into a
 * view (filters, sort, page) of a stored query's result, over its known
 * columns only, in one model call with no tools and no memory. A System
 * agent: the query inspector's filter in words (api.md 152, 154) calls him
 * through `interpretResultWithModel`; his job description is the shipped
 * instructions or their in-app override (ADR-0026).
 */
export const resultExplorerAgent = new Agent({
  id: 'result-explorer',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Result Explorer',
  description:
    "Turns a user's words into filters, a sort and a page over a query's result columns. No tools, no SQL.",
  instructions: () =>
    agentInstructions(RESULT_EXPLORER_AGENT_KEY, RESULT_EXPLORER_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
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
 * The model call (api.md 152, 154): the request holds no SQL and no whole
 * rows. A model error, or a reply that is no JSON object, throws; the
 * reply is read by `specOf`.
 */
export async function interpretResultWithModel(
  input: InterpretResultInput,
  options: { abortSignal?: AbortSignal } = {},
): Promise<ExplorerSpec> {
  const result = (await resultExplorerAgent.generate(
    explorerRequest(input.text, input.candidates, input.view, input.pageCount),
    {
      maxSteps: 1,
      toolChoice: 'none',
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      structuredOutput: {
        schema: RESULT_EXPLORER_REPLY_SCHEMA,
        jsonPromptInjection: 'inline',
        errorStrategy: 'warn',
      },
    },
  )) as { object?: unknown; text?: string; error?: unknown };
  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new Error(runErrorMessage(result.error));
  }
  return specOf(
    result.object ?? result.text,
    input.candidates,
    input.view,
    input.pageCount,
  );
}
