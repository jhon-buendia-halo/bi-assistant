import { createHash } from 'node:crypto';
import { assistantShippedPrompt } from './agents/assistant-prompt';
import {
  EVAL_JUDGE_PROMPT,
  KNOWLEDGE_BOOTSTRAP_PROMPT,
  RFP_PROMPT,
  SQL_FIXER_PROMPT,
  SQL_VERIFIER_PROMPT,
  VISUALIZATION_PROMPT,
} from './agents/system-prompts';
import {
  BENCHMARKING_PROMPT,
  LAD_COE_PROMPT,
  STRATEGY_PROMPT,
  SURVEY_PROMPT,
} from './agents/showcase-catalog';

/**
 * The shipped, editable system prompt of each built-in agent, by registry
 * key (ADR-0026, data-model 3.10.3): the assistant's and the RFP Builder's
 * without their generated `## Tools` section, a System agent's whole static
 * instructions.
 */
const SHIPPED: Readonly<Record<string, string>> = {
  assistant: assistantShippedPrompt(),
  visualization: VISUALIZATION_PROMPT,
  'sql-fixer': SQL_FIXER_PROMPT,
  'sql-verifier': SQL_VERIFIER_PROMPT,
  'knowledge-bootstrap': KNOWLEDGE_BOOTSTRAP_PROMPT,
  'assistant-eval-judge': EVAL_JUDGE_PROMPT,
  rfp: RFP_PROMPT,
  benchmarking: BENCHMARKING_PROMPT,
  survey: SURVEY_PROMPT,
  'lad-coe': LAD_COE_PROMPT,
  strategy: STRATEGY_PROMPT,
};

/** The shipped editable prompt of a built-in agent; undefined for any other key. */
export function shippedAgentPrompt(key: string): string | undefined {
  return Object.hasOwn(SHIPPED, key) ? SHIPPED[key] : undefined;
}

/** SHA-256 hex of a shipped prompt: the override's `baseHash`. */
export function agentPromptHash(shipped: string): string {
  return createHash('sha256').update(shipped).digest('hex');
}
