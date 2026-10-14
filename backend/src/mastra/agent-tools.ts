/**
 * A user agent's tool selection (ADR-0022, agents.md 2.1 and 4.2): which of
 * the assistant's optional tools a call offers. `list_entities`,
 * `describe_entity` and `run_readonly_sql` are always given and never listed.
 */

/** requestContext key carrying the selection of a call (agents.md 4.2). */
export const AGENT_TOOLS_CONTEXT_KEY = 'agent-tools';

/** The optional tools, in their canonical (stored) order. */
export const OPTIONAL_AGENT_TOOLS = [
  'sample_rows',
  'ask_clarification',
  'visuals',
] as const;

export type OptionalAgentTool = (typeof OPTIONAL_AGENT_TOOLS)[number];

/** The assistant tools each optional tool id stands for. */
export const OPTIONAL_TOOL_NAMES: Record<OptionalAgentTool, readonly string[]> =
  {
    sample_rows: ['sample_rows'],
    ask_clarification: ['ask_clarification'],
    visuals: ['create_visual', 'update_visual'],
  };

function isOptionalAgentTool(value: unknown): value is OptionalAgentTool {
  return (OPTIONAL_AGENT_TOOLS as readonly unknown[]).includes(value);
}

/**
 * De-duplicate a `tools` list and put it in canonical order (data-model
 * 3.10). Throws `Unknown tool "<name>"` for the first entry that is not one
 * of the three optional tools (agents-evals R43).
 */
export function normalizeAgentTools(
  values: readonly string[],
): OptionalAgentTool[] {
  const unknown = values.find((value) => !isOptionalAgentTool(value));
  if (unknown !== undefined) throw new Error(`Unknown tool "${unknown}"`);
  return OPTIONAL_AGENT_TOOLS.filter((tool) => values.includes(tool));
}

/** True when `tools` is absent or selects every optional tool. */
export function isFullSelection(tools: readonly string[] | undefined): boolean {
  return !tools || OPTIONAL_AGENT_TOOLS.every((tool) => tools.includes(tool));
}

/**
 * The tool selection a call runs with, in canonical order, or undefined for
 * every tool: no selection on the context, or all three selected.
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

/** A stable cache key for a selection: `full`, or the ids joined. */
export function selectionKey(
  selection: readonly OptionalAgentTool[] | undefined,
): string {
  return selection ? selection.join(',') : 'full';
}
