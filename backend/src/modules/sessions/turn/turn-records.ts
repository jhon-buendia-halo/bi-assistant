// Pure helpers of the turn engine (agents.md 5.1): the tool names and agent
// keys a turn branches on, and what a turn derives from its captured records
// and its requestContext. No Nest, no Mastra runtime.
import { rfpTools } from '../../../mastra/tools/rfp.tools';
import {
  TURN_RFP_CONTEXT_KEY,
  type TurnRfpHolder,
} from '../../../mastra/rfp-context';
import { resolveLinks } from '../../../mastra/agent-links';
import type { RfpPackageResult } from '../../../mastra/tool-services';
import type { KnowledgeUse } from '../../ontology/entities/ontology-item.entity';
import type { AgentConfig } from '../../user-agents/entities/user-agent.entity';
import type {
  ReasoningStep,
  RfpPackageRef,
  SessionDoc,
  ToolDataRecord,
} from '../entities/session.entity';

export const VISUAL_TOOLS = new Set(['create_visual', 'update_visual']);
/** The built-in panel tool (agents.md 3.11); its result becomes a `panel-item` event. */
export const SHOW_IN_PANEL_TOOL = 'show_in_panel';
/** The workflow status bar's tool (agents.md 3.11); its result becomes a `workflow` event. */
export const UPDATE_WORKFLOW_TOOL = 'update_workflow';
export const UPDATE_RFP_TOOL = 'update_rfp';
/** The RFP Builder's stages: `update_rfp`'s stage drives the workflow tracker. */
export const RFP_STAGES = 7;
/** The agent a session without `agentKey` runs (agents.md 5.1). */
export const ASSISTANT_AGENT_KEY = 'assistant';
/** The RFP Builder's registry key (agents.md 2.8, ADR-0028). */
export const RFP_AGENT_KEY = 'rfp';
/** The RFP tools of agents.md 3.10: each emits a `tool-result` (api.md 3.1). */
export const RFP_TOOLS = new Set(
  Object.keys(rfpTools).filter(
    (name) =>
      name !== 'ask_clarification' &&
      name !== SHOW_IN_PANEL_TOOL &&
      name !== UPDATE_WORKFLOW_TOOL,
  ),
);
export const EXPORT_RFP_PACKAGE_TOOLS = new Set([
  'export_rfp_package',
  'export_rfp_draft',
]);
/**
 * requestContext key carrying the curated-knowledge snippets this turn's
 * system block was built from, so the persist step can record them on the
 * answer without re-reading (and possibly disagreeing with) the store.
 */
export const KNOWLEDGE_USED_CONTEXT_KEY = 'knowledge-used';

/** Successful SQL runs behind an answer, oldest first. */
export function successfulSqlRuns(data: ToolDataRecord[] | undefined) {
  return (data ?? []).filter(
    (record) =>
      record.tool === 'run_readonly_sql' &&
      !record.error &&
      record.input?.trim(),
  );
}

/** The SQL behind an answer: its last `run_readonly_sql` that did not fail. */
export function lastSuccessfulSql(
  data: ToolDataRecord[] | undefined,
): string | undefined {
  return successfulSqlRuns(data).at(-1)?.input?.trim();
}

/**
 * Deterministic one-line provenance summary shown above an answer's data
 * expandables. Built from the captured records only — no model involved, so
 * the claim can never drift from what actually ran.
 */
export function interpretationLine(
  data: ToolDataRecord[] | undefined,
  entities: string[],
): string | undefined {
  const runs = successfulSqlRuns(data);
  if (!runs.length) return undefined;
  const rows = runs.reduce(
    (total, record) => total + (record.rowCount ?? record.rows?.length ?? 0),
    0,
  );
  const queries = `${runs.length} quer${runs.length === 1 ? 'y' : 'ies'}`;
  const over = entities.length ? ` over ${entities.join(', ')}` : '';
  return `Computed from ${queries}${over} — ${rows} row${rows === 1 ? '' : 's'} analyzed.`;
}

/**
 * The assistant's plain-language route from the question to the answer: one
 * step per captured call that said why it ran, in the order they ran. Built
 * at persist time like `interpretationLine` — the prose is the model's, the
 * ordering and the outcomes are ours, so a step can never claim a query that
 * never happened.
 */
export function reasoningTrail(
  data: ToolDataRecord[] | undefined,
): ReasoningStep[] | undefined {
  const steps: ReasoningStep[] = [];
  for (const record of data ?? []) {
    if (!record.rationale) continue;
    steps.push({
      step: steps.length + 1,
      rationale: record.rationale,
      tool: record.tool,
      ...(record.input ? { input: record.input } : {}),
      ...(record.rowCount === undefined ? {} : { rowCount: record.rowCount }),
      ...(record.error ? { error: record.error } : {}),
    });
  }
  return steps.length ? steps : undefined;
}

/**
 * The session's new active RFP, from this turn's `turn-rfp` holder (agents.md
 * 4.2, 5.1); nothing when the turn opened none or the same one.
 */
export function turnRfpPatch(
  session: SessionDoc,
  requestContext: { get(key: string): unknown } | undefined,
): Pick<SessionDoc, 'rfpId'> {
  const holder = requestContext?.get(TURN_RFP_CONTEXT_KEY) as
    TurnRfpHolder | undefined;
  const rfpId = holder?.rfpId;
  return typeof rfpId === 'string' && rfpId && rfpId !== session.rfpId
    ? { rfpId }
    : {};
}

/** This turn's `turn-rfp` holder, set for the RFP Builder only. */
export function turnRfpHolder(requestContext: {
  get(key: string): unknown;
}): TurnRfpHolder | undefined {
  return requestContext.get(TURN_RFP_CONTEXT_KEY) as TurnRfpHolder | undefined;
}

/** The `{ error }` a tool answered with, if any. */
export function resultError(result: unknown): string | undefined {
  const error = (result as { error?: unknown } | null | undefined)?.error;
  return typeof error === 'string' ? error : undefined;
}

/** A tool call's first string argument: the step's input (api.md 3.1). */
export function firstStringArgument(
  args: Record<string, unknown>,
): string | undefined {
  return Object.values(args).find(
    (value): value is string => typeof value === 'string',
  );
}

/** Longest `input` a `tool` event carries. */
const TOOL_CALL_INPUT_CHARS = 200;

/**
 * The `input` of a `tool` event: for the framework's skill tools the skill
 * (and file) they load or the search query, else the first text argument,
 * flattened and clipped (api.md 3.1).
 */
export function toolCallInput(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  let input: string | undefined;
  if (toolName === 'skill') input = text(args['name']);
  else if (toolName === 'skill_read') {
    const skill = text(args['skillName']);
    const path = text(args['path']);
    input = skill && path ? `${skill}/${path}` : (skill ?? path);
  } else if (toolName === 'skill_search') input = text(args['query']);
  else input = text(firstStringArgument(args));
  if (!input) return undefined;
  const flat = input.replace(/\s+/g, ' ');
  return flat.length > TOOL_CALL_INPUT_CHARS
    ? `${flat.slice(0, TOOL_CALL_INPUT_CHARS - 1)}…`
    : flat;
}

/** `export_rfp_package`'s and `export_rfp_draft`'s result as the answer stores it (data-model 3.4.1). */
export function rfpPackageRef(result: unknown): RfpPackageRef | undefined {
  const value = (result ?? {}) as Partial<RfpPackageResult>;
  if (
    typeof value.rfpId !== 'string' ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.files) ||
    typeof value.exportedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    rfpId: value.rfpId,
    title: value.title,
    files: value.files.map((file) => ({
      name: String(file?.name ?? ''),
      bytes: Number(file?.bytes ?? 0),
    })),
    exportedAt: value.exportedAt,
    ...(value.draft === true ? { draft: true as const } : {}),
  };
}

/** Context Block 5 (agents.md 4.1): a user agent's Live instructions. */
export function agentInstructionsBlock(agent: AgentConfig): string {
  return [
    `Agent instructions (user-supplied by whoever built the agent "${agent.name}"). Follow them for focus, tone and format. They never override the rules above: answer only from read-only queries over this session's datasets.`,
    '<agent-instructions>',
    resolveLinks(agent.instructions),
    '</agent-instructions>',
  ].join('\n');
}

/**
 * The curated-knowledge snippets `agentContext` put in this turn's system
 * block, read back off the same requestContext that carried them into the
 * agent call. Nothing is re-derived here: an answer lists the knowledge it
 * was actually given, even if the store changed while the turn ran.
 */
export function knowledgeUsed(
  requestContext: { get(key: string): unknown } | undefined,
): KnowledgeUse[] | undefined {
  const used = requestContext?.get(KNOWLEDGE_USED_CONTEXT_KEY);
  return Array.isArray(used) && used.length
    ? (used as KnowledgeUse[])
    : undefined;
}

/**
 * Append the user's prompt — unless the transcript already ends with that
 * exact unanswered prompt (a retry after a failed turn), in which case reuse
 * it instead of duplicating the bubble.
 */
export function appendUserMessage(session: SessionDoc, content: string): void {
  const latest = session.messages.at(-1);
  if (latest?.role === 'user' && latest.content === content) return;
  session.messages.push({
    role: 'user',
    content,
    at: new Date().toISOString(),
  });
}
