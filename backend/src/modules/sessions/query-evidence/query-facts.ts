/**
 * The side channel of the query facts (plan docs/plans/m1-25-query-inspector.md
 * 1.25.1). Re-exported by `mastra/tool-services.ts`; kept here, framework-free,
 * so the turn engine and its tests read the same key without loading the
 * tool bridge.
 */
import type { QueryFacts } from './query-evidence.types';

/**
 * requestContext key of the turn's query facts: a `Map<string, QueryFacts>`
 * the turn engine creates per turn. The data tools write what they knew
 * about each call there, beside the result, so the model's input never
 * changes. Keyed by the tool call id, and also by
 * `queryFactsKey(tool, input)` for a caller that has no id.
 */
export const QUERY_FACTS_CONTEXT_KEY = 'queryFacts';

export type QueryFactsMap = Map<string, QueryFacts>;

/**
 * The text key of a call's facts: the tool and what its record's `input`
 * holds (the statement that ran, or the sampled entity).
 */
export function queryFactsKey(tool: string, input: string | undefined): string {
  return `${tool}\u0000${input ?? ''}`;
}
