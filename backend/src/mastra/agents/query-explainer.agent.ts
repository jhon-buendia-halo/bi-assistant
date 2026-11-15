import { Agent } from '@mastra/core/agent';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type {
  QueryEvidence,
  QueryExplanation,
} from '../../modules/sessions/query-evidence/query-evidence.types';
import { runErrorMessage } from '../workflows/workflow-run';
import { agentInstructions } from '../agent-prompt-overrides';
import { QUERY_EXPLAINER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import {
  explainReplySchema,
  explainRequest,
  explanationOf,
  QUERY_EXPLAINER_INSTRUCTIONS,
} from './query-explainer.prompts';

/**
 * Hannah, Query Explainer (agents.md 1.1, 2.15): explains one stored query
 * step by step in business words, in one model call with no tools and no
 * memory. A System agent: the query inspector's route calls her through
 * `explainQueryWithModel`; her job description is the shipped instructions
 * or their in-app override (ADR-0026).
 */
export const queryExplainerAgent = new Agent({
  id: 'query-explainer',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Query Explainer',
  description:
    'Explains one SQL query step by step in business words, with a count statement per step. No tools.',
  instructions: () =>
    agentInstructions(QUERY_EXPLAINER_AGENT_KEY, QUERY_EXPLAINER_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});

/**
 * The model call (api.md 140): the request never holds result rows. A model
 * error throws; a reply that is no JSON object gives the code-built steps
 * flagged `fallback` (`explanationOf`).
 */
export async function explainQueryWithModel(
  input: { record: ToolDataRecord; evidence: QueryEvidence },
  options: { abortSignal?: AbortSignal } = {},
): Promise<QueryExplanation> {
  const result = (await queryExplainerAgent.generate(
    explainRequest(input.record, input.evidence),
    {
      maxSteps: 1,
      toolChoice: 'none',
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      structuredOutput: {
        schema: explainReplySchema,
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
  return explanationOf(
    result.object ?? result.text,
    input.record,
    input.evidence,
  );
}
