/**
 * The `## Workflow` convention of an agent's prompt (ADR-0029, agents.md
 * 3.11): a numbered list of phases the app parses to show every phase in the
 * right panel from the first turn. Plain code with no Mastra import, so the
 * orchestrator and the tool share it.
 */

/** One phase of the list. */
export interface ParsedWorkflowPhase {
  /** Position in the list (the written number is ignored). */
  number: number;
  title: string;
  /** The skill the line links with `— [[skill:name]]`. */
  skill?: string;
  /** What the user does in this step: the text after `: ` on the line. */
  action?: string;
}

const MAX_PHASES = 20;
const TITLE_CHARS = 80;
const HEADING = '## Workflow';
const ACTION_CHARS = 120;
const PHASE_LINE = /^\s*(\d+)[.)]\s+(.+?)\s*$/;
/** `Title — [[skill:name]]`, optionally followed by `: action`. */
const WITH_SKILL =
  /^(.+?)\s+[—–-]\s+\[\[skill:([A-Za-z0-9_-]+)\]\](?::\s+(.+))?$/;
/** `Title: action`: the action is everything after the first `: `. */
const WITH_ACTION = /^(.+?):\s+(.+)$/;

/**
 * The phases of the prompt's `## Workflow` section: from the line that is
 * exactly `## Workflow` to the next `## ` heading. Other lines are prose.
 * Parse the prompt with its links intact.
 */
export function parseWorkflow(prompt: string): ParsedWorkflowPhase[] {
  const lines = (prompt ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === HEADING);
  if (start === -1) return [];
  const phases: ParsedWorkflowPhase[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const match = PHASE_LINE.exec(line);
    if (!match) continue;
    const body = match[2];
    const withSkill = WITH_SKILL.exec(body);
    const withAction = withSkill ? null : WITH_ACTION.exec(body);
    const title = (withSkill?.[1] ?? withAction?.[1] ?? body).trim();
    const skill = withSkill?.[2];
    const rawAction = (withSkill?.[3] ?? withAction?.[2])?.trim();
    const action =
      rawAction && rawAction.length > ACTION_CHARS
        ? rawAction.slice(0, ACTION_CHARS).trimEnd()
        : rawAction;
    phases.push({
      number: phases.length + 1,
      title:
        title.length > TITLE_CHARS
          ? `${title.slice(0, TITLE_CHARS - 1)}…`
          : title,
      ...(skill ? { skill } : {}),
      ...(action ? { action } : {}),
    });
    if (phases.length === MAX_PHASES) break;
  }
  return phases;
}
