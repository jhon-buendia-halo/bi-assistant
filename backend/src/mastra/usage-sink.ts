/**
 * How an eval attempt hears about the model calls made on its behalf
 * (agents-evals R219; agents.md 8.3). The eval puts a sink on the attempt's
 * requestContext; whatever calls a model inside that attempt (the assistant's
 * generate, the SQL fixer, the visual designer, the judge) passes its result
 * to the sink, which records the tokens. Outside an eval there is no sink and
 * nothing is recorded, so chat turns are unchanged.
 *
 * Pure module: no Nest, no Mastra. The requestContext is typed by the one
 * method read here, as `agent-tools.ts` reads the tool selection.
 */
import type { UsageAgent } from './evals/eval-usage';

/** requestContext key carrying an eval attempt's usage sink. */
export const USAGE_SINK_CONTEXT_KEY = 'eval-usage-sink';

/**
 * Receives one model call's result. `model` is the model the call ran on,
 * when the caller knows it; the eval names the run's model otherwise.
 */
export type UsageSink = (
  agent: UsageAgent,
  result: unknown,
  model?: string,
) => void;

/**
 * The sink on a call's requestContext, or undefined when there is none (any
 * call outside an eval). The sink returned never throws: recording tokens
 * must not fail the turn or the attempt it measures.
 */
export function usageSinkFrom(requestContext?: {
  get(key: string): unknown;
}): UsageSink | undefined {
  const sink = requestContext?.get(USAGE_SINK_CONTEXT_KEY);
  if (typeof sink !== 'function') return undefined;
  return (agent, result, model) => {
    try {
      (sink as UsageSink)(agent, result, model);
    } catch {
      // A broken sink loses that call's tokens, never the call.
    }
  };
}
