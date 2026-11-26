import { z } from 'zod';
import { defineBuiltinAgent } from '../agent-factory';
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
export const sqlVerifierAgent = defineBuiltinAgent({
  key: 'sql-verifier',
  name: 'SQL Verifier',
  description:
    "Careful mode's second opinion — re-derives the SQL for a question independently to corroborate the answer.",
  classes: ['single-step'],
  instructions: SQL_VERIFIER_PROMPT,
  model: 'saved',
});
