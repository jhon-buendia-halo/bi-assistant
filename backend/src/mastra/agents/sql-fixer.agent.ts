import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
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
export const sqlFixerAgent = new Agent({
  id: 'sql-fixer',
  name: 'SQL Fixer',
  description:
    'Repairs a SQL statement that failed to execute, using the engine error as the signal.',
  // The shipped prompt, or the in-app override (ADR-0026).
  instructions: () => agentInstructions('sql-fixer', SQL_FIXER_PROMPT),
  // Same configured model as the analysis agent; see ../model-resolver.
  model: async () => resolveAgentModel(),
});
