import { type PromptTool, toolLines } from './agents/assistant-prompt';

/**
 * The generated `## Tools` section of an agent whose editable prompt leaves
 * it out (agents.md 1.1, 2.8): one line per tool, `- <name>(<input names>):
 * <first sentence of the description>`, by the assistant's rule.
 */
export function toolSection(tools: Record<string, PromptTool>): string[] {
  return ['## Tools', ...toolLines(tools)];
}

/**
 * `prompt` with the `## Tools` section inserted, after a blank line, before
 * the first line that is exactly `## Working rules`; appended after a blank
 * line when there is none (agents.md 2.8, ADR-0026).
 */
export function withToolSection(
  prompt: string,
  tools: Record<string, PromptTool>,
): string {
  const lines = prompt.split('\n');
  const section = toolSection(tools);
  const at = lines.indexOf('## Working rules');
  if (at < 0) return `${prompt.trimEnd()}\n\n${section.join('\n')}`;
  // The shipped prompt already has a blank line before `## Working rules`;
  // the section goes after it and gets its own blank line.
  const before = lines.slice(0, at);
  if (before.length && before[before.length - 1] !== '') before.push('');
  return [...before, ...section, '', ...lines.slice(at)].join('\n');
}
