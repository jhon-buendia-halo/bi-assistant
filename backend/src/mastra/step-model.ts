/**
 * A workflow's own model for its step agents (agents.md 1.3): Answer a
 * Business Question runs its agents on `ANSWER_BUSINESS_QUESTION_MODEL`
 * (workflows/answer-business-question.review.ts) when the saved model is
 * served as a Claude model. The turn puts it on the call's requestContext;
 * only those agents' model functions read it, so every other agent resolves
 * the persisted model. Type imports only: no framework, no resolver state.
 */
import type { ReasoningEffort } from './effort-levels';
import type { AgentModelConfig } from './model-resolver';

/** The requestContext key carrying a workflow's step model. */
export const STEP_MODEL_CONTEXT_KEY = 'step-model';

/** A model name on the saved provider, and the effort to send with it. */
export interface StepModel {
  model: string;
  reasoningEffort: ReasoningEffort;
}

/** The step model on a call's requestContext, if any. */
export function stepModelFrom(requestContext?: {
  get(key: string): unknown;
}): StepModel | undefined {
  if (typeof requestContext?.get !== 'function') return undefined;
  const stepModel = requestContext.get(STEP_MODEL_CONTEXT_KEY) as
    StepModel | undefined;
  return stepModel?.model ? stepModel : undefined;
}

/**
 * Whether the saved model is served as a Claude model, so a Claude model
 * name can replace it on the same provider: the Anthropic provider, an
 * Anthropic-compatible custom endpoint, or an OpenAI-compatible endpoint
 * serving a Claude model (a gateway such as CLIProxyAPI). Never Copilot,
 * whose seat names its own models.
 */
export function servesClaude(config: AgentModelConfig): boolean {
  const id = typeof config === 'string' ? config : config.id;
  if (id.startsWith('copilot/')) return false;
  return id.startsWith('anthropic/') || /claude/i.test(id);
}
