import { z } from 'zod';
import { defineBuiltinAgent } from '../agent-factory';
import { SQL_FIXER_PROMPT } from './system-prompts';

export const sqlFixOutputSchema = z.object({
  sql: z
    .string()
    .describe('One corrected read-only SELECT or WITH statement, nothing else'),
});

/**
 * Execution-guided repair: a failed statement plus the engine error is enough
 * signal to fix most NL2SQL mistakes (wrong column, bad cast, dialect slip).
 * Single step, no tools, structured output — the analysis agent never sees it.
 */
export const sqlFixerAgent = defineBuiltinAgent({
  key: 'sql-fixer',
  name: 'SQL Fixer',
  description:
    'Repairs a SQL statement that failed to execute, using the engine error as the signal.',
  classes: ['single-step'],
  instructions: SQL_FIXER_PROMPT,
  model: 'saved',
});
