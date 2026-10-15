import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
import { SQL_VERIFIER_PROMPT } from './system-prompts';

export const sqlVerifyOutputSchema = z.object({
  sql: z
    .string()
    .describe(
      'One read-only SELECT or WITH statement that answers the question, nothing else',
    ),
});

/**
 * Careful mode's second opinion. It re-derives the SQL for a question from
 * scratch — it never sees the statement the analysis agent ran, so agreement
 * between the two result sets is real corroboration rather than an echo.
 * Single step, no tools, structured output.
 */
export const sqlVerifierAgent = new Agent({
  id: 'sql-verifier',
  name: 'SQL Verifier',
  description:
    "Careful mode's second opinion — re-derives the SQL for a question independently to corroborate the answer.",
  // The shipped prompt, or the in-app override (ADR-0026).
  instructions: () => agentInstructions('sql-verifier', SQL_VERIFIER_PROMPT),
  // Same configured model as the analysis agent; see ../model-resolver.
  model: async () => resolveAgentModel(),
});
