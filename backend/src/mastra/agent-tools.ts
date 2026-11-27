/**
 * A user agent's tool selection (ADR-0022, agents.md 2.23 and 4.2): which of
 * Elena's optional tools a call offers (ADR-0059). `list_entities`,
 * `describe_entity`, `run_readonly_sql` and `explore_result` are always
 * given and never listed.
 */

/** requestContext key carrying the selection of a call (agents.md 4.2). */
export const AGENT_TOOLS_CONTEXT_KEY = 'agent-tools';

/** The optional tools, in their canonical (stored) order. */
export const OPTIONAL_AGENT_TOOLS = [
  'sample_rows',
  'ask_clarification',
] as const;

export type OptionalAgentTool = (typeof OPTIONAL_AGENT_TOOLS)[number];

/**
 * Optional tools of the removed assistant (ADR-0059): a stored selection
 * may still name one; it is dropped without a message.
 */
export const RETIRED_AGENT_TOOLS: readonly string[] = ['visuals'];

/** The tools each optional tool id stands for. */
export const OPTIONAL_TOOL_NAMES: Record<OptionalAgentTool, readonly string[]> =
  {
    sample_rows: ['sample_rows'],
    ask_clarification: ['ask_clarification'],
  };

function isOptionalAgentTool(value: unknown): value is OptionalAgentTool {
  return (OPTIONAL_AGENT_TOOLS as readonly unknown[]).includes(value);
}

/**
 * De-duplicate a `tools` list and put it in canonical order (data-model
 * 3.10). A retired tool (`visuals`) is dropped silently; throws `Unknown
 * tool "<name>"` for the first other entry that is not an optional tool
 * (agents-evals R43).
 */
export function normalizeAgentTools(
  values: readonly string[],
): OptionalAgentTool[] {
  const unknown = values.find(
    (value) =>
      !isOptionalAgentTool(value) && !RETIRED_AGENT_TOOLS.includes(value),
  );
  if (unknown !== undefined) throw new Error(`Unknown tool "${unknown}"`);
  return OPTIONAL_AGENT_TOOLS.filter((tool) => values.includes(tool));
}

/** True when `tools` is absent or selects every optional tool. */
export function isFullSelection(tools: readonly string[] | undefined): boolean {
  return !tools || OPTIONAL_AGENT_TOOLS.every((tool) => tools.includes(tool));
}

/**
 * The tool selection a call runs with, in canonical order, or undefined for
 * every tool: no selection on the context, or both selected.
 */
export function toolSelectionFrom(requestContext?: {
  get(key: string): unknown;
}): OptionalAgentTool[] | undefined {
  const value = requestContext?.get(AGENT_TOOLS_CONTEXT_KEY);
  if (!Array.isArray(value)) return undefined;
  const selection = OPTIONAL_AGENT_TOOLS.filter((tool) => value.includes(tool));
  return isFullSelection(selection) ? undefined : selection;
}

/** Whether `tool` is offered under `selection` (undefined = every tool). */
export function selects(
  selection: readonly OptionalAgentTool[] | undefined,
  tool: OptionalAgentTool,
): boolean {
  return !selection || selection.includes(tool);
}
