import { createHash } from 'node:crypto';
import { assistantShippedPrompt } from './agents/assistant-prompt';
import {
  PLAN_INSTRUCTIONS,
  WRITE_ANSWER_INSTRUCTIONS,
} from './workflows/qti-v2-turn.prompts';
import {
  ASSISTANT_V2_PROMPT,
  DATA_READINESS_PROMPT,
  EVAL_JUDGE_PROMPT,
  KNOWLEDGE_BOOTSTRAP_PROMPT,
  SQL_FIXER_PROMPT,
  SQL_VERIFIER_PROMPT,
  VISUALIZATION_PROMPT,
} from './agents/system-prompts';

/**
 * The shipped, editable system prompt of each built-in agent, by registry
 * key (ADR-0026, data-model 3.10.3): the assistant's, Questions to Insights v2's,
 * and the Data Readiness Agent's without their generated `## Tools` section, a System agent's whole static
 * instructions.
 */
const SHIPPED: Readonly<Record<string, string>> = {
  assistant: assistantShippedPrompt(),
  'assistant-v2': ASSISTANT_V2_PROMPT,
  visualization: VISUALIZATION_PROMPT,
  'sql-fixer': SQL_FIXER_PROMPT,
  'sql-verifier': SQL_VERIFIER_PROMPT,
  'knowledge-bootstrap': KNOWLEDGE_BOOTSTRAP_PROMPT,
  'assistant-eval-judge': EVAL_JUDGE_PROMPT,
  'data-readiness': DATA_READINESS_PROMPT,
  'analysis-planner': PLAN_INSTRUCTIONS,
  'answer-writer': WRITE_ANSWER_INSTRUCTIONS,
};

/** The shipped editable prompt of a built-in agent; undefined for any other key. */
export function shippedAgentPrompt(key: string): string | undefined {
  return Object.hasOwn(SHIPPED, key) ? SHIPPED[key] : undefined;
}

/** SHA-256 hex of a shipped prompt: the override's `baseHash`. */
export function agentPromptHash(shipped: string): string {
  return createHash('sha256').update(shipped).digest('hex');
}
