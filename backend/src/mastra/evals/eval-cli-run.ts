/** What a run records when no model is saved (data-model 3.2). */
const FALLBACK_PROVIDER = 'openai';
const FALLBACK_MODEL = 'gpt-4o-mini';

/**
 * The provider and model a run records, from the saved LLM settings view
 * (ADR-0054). The command line's runs are saved by `EvalRunsService` like the
 * app's (agents-evals R223); an `EVAL_LLM_*` endpoint names its own label.
 */
export function savedLlmLabel(view: {
  provider?: string | null;
  model?: string | null;
}): { provider: string; model: string } {
  return {
    provider: view.provider ?? FALLBACK_PROVIDER,
    model: view.model ?? FALLBACK_MODEL,
  };
}
