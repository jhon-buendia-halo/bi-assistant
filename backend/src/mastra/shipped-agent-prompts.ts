import { createHash } from 'node:crypto';
import { assistantShippedPrompt } from './agents/assistant-prompt';
import {
  PLAN_INSTRUCTIONS,
  WRITE_ANSWER_INSTRUCTIONS,
} from './workflows/answer-business-question.prompts';
import { QUERY_EXPLAINER_INSTRUCTIONS } from './agents/query-explainer.prompts';
import {
  MAP_DATA_INSTRUCTIONS,
  READ_DASHBOARD_INSTRUCTIONS,
} from './workflows/recreate-dashboard.prompts';
import { READ_IMAGES_INSTRUCTIONS } from './workflows/read-images.prompts';
import {
  INSIGHTS_ANALYST_PROMPT,
  DATA_READINESS_PROMPT,
  EVAL_JUDGE_PROMPT,
  KNOWLEDGE_BOOTSTRAP_PROMPT,
  SQL_FIXER_PROMPT,
  SQL_VERIFIER_PROMPT,
  VISUALIZATION_PROMPT,
} from './agents/system-prompts';

/**
 * The shipped, editable system prompt of each built-in agent, by registry
 * key (ADR-0026, data-model 3.10.3): the assistant's, Insights Analyst's,
 * and the Data Readiness Agent's without their generated `## Tools` section, a System agent's whole static
 * instructions.
 */
const SHIPPED: Readonly<Record<string, string>> = {
  assistant: assistantShippedPrompt(),
  'insights-analyst': INSIGHTS_ANALYST_PROMPT,
  visualization: VISUALIZATION_PROMPT,
  'sql-fixer': SQL_FIXER_PROMPT,
  'sql-verifier': SQL_VERIFIER_PROMPT,
  'knowledge-bootstrap': KNOWLEDGE_BOOTSTRAP_PROMPT,
  'assistant-eval-judge': EVAL_JUDGE_PROMPT,
  'data-readiness': DATA_READINESS_PROMPT,
  'analysis-planner': PLAN_INSTRUCTIONS,
  'answer-writer': WRITE_ANSWER_INSTRUCTIONS,
  'dashboard-reader': READ_DASHBOARD_INSTRUCTIONS,
  'data-mapper': MAP_DATA_INSTRUCTIONS,
  'image-reader': READ_IMAGES_INSTRUCTIONS,
  'query-explainer': QUERY_EXPLAINER_INSTRUCTIONS,
};

/** The shipped editable prompt of a built-in agent; undefined for any other key. */
export function shippedAgentPrompt(key: string): string | undefined {
  return Object.hasOwn(SHIPPED, key) ? SHIPPED[key] : undefined;
}

/** SHA-256 hex of a shipped prompt: the override's `baseHash`. */
export function agentPromptHash(shipped: string): string {
  return createHash('sha256').update(shipped).digest('hex');
}
