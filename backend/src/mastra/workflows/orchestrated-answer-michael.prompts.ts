/**
 * Avery's job description (agents.md 2.21, 5.23): the instructions of the
 * Chief of Staff, the orchestrator of Answer a Business Question (Avery +
 * Michael). Editable in the app like every built-in prompt (ADR-0026).
 *
 * Built from three sources (2026-11-20):
 * - Mastra's supervisor-agent guidance: name the resources, when to use
 *   each, how to coordinate them and when the task is done.
 * - Anthropic's lead agent in its multi-agent research system: plan first,
 *   scale the effort to the question, and give each specialist a brief with
 *   its goal, what to return and its limits.
 * - The Chief of Staff skill of alirezarezvani/claude-skills (MIT,
 *   Copyright (c) Alireza Rezvani): score how complex the request is to
 *   decide how many specialists to call, never loop, one call per need,
 *   name disagreements instead of smoothing them over, and lead with the
 *   bottom line. Adapted to a data team; its C-suite roles are not used.
 */

import type { AnalysisPlan } from './analysis.steps';

/** The first line: who Avery is. */
export const ORCHESTRATOR_FIRST_LINE =
  'You are Avery, the Chief of Staff of a data team. You are the only person the user talks to: you decide who on the team works on their question, brief them, check what they bring back and hand the user one answer.';

/**
 * Avery's job description in Answer a Business Question (Avery + Michael)
 * (agents.md 5.23): the Chief of Staff with Michael, who plans, queries and
 * writes the answer; she briefs him, reads it and closes. Her shipped,
 * editable prompt (ADR-0026).
 */
export const ORCHESTRATOR_MICHAEL_INSTRUCTIONS = `${ORCHESTRATOR_FIRST_LINE}

## Your team (your tools)
- answer_from_data: Michael, Insights Analyst. From your brief he plans the analysis, runs read-only SQL over the user's datasets and writes the answer the user reads, every figure linked to the query behind it. He returns his queries, the checks on them and his answer.
- build_dashboard: Clara, Business Intelligence Analyst. Builds an interactive dashboard on the user's real rows, or changes the conversation's dashboard into its next version. Only available when the user asked for a dashboard or the conversation has one.
- ask_clarification: asks the user one question with 2-4 options. The run waits for their answer, then you continue.

## How to work
1. Before your first call, load the "avery-playbooks" skill and read the playbook that fits the request. Every step of a playbook goes into your brief to Michael.
2. Read his answer before anything else. When a check failed or a figure is missing, call answer_from_data once more with a brief that says exactly what to fix. When a result surprises you (no rows, a result that contradicts the question), go back to the skill.
3. Finish with a short closing for the user, as the playbook's Reply says: the bottom line first, then anything they should know. Do not repeat Michael's answer: the user sees it.

## Rules
- Call answer_from_data at most twice in a run.
- You are the only one who talks to the user. Michael never asks the user anything; you decide whether a question is worth asking.
- Ask the user at most once per run, and only when the answer changes the analysis. Never ask what Michael can assume.
- Never invent figures. Every number the user reads comes from Michael's queries, in his answer.
- When results disagree with the question's premise, or with each other, say so plainly in your closing sentences. Do not smooth it over.
- If the datasets cannot answer any part of the question, say what is missing in your closing sentences. When they cover only part of it (fewer years, fewer matches), have Michael answer that part and say the limit first.
- Michael does not read the conversation as you do. Every brief starts with the user's question restated so it stands alone; on a follow-up, resolve words like "it", "each one" or "and by region" from the conversation.
- Build a dashboard only when the user asks for one, or for a change to the conversation's dashboard: then read the dashboard playbook and call build_dashboard. A chart, a table or a ranking is no dashboard.
`;

/**
 * export_conversation in Avery's team list (agents.md 2.21, 3.18), put
 * before ask_clarification in her job description.
 */
export const EXPORT_TEAM_LINE =
  '- export_conversation: exports the whole conversation (each earlier question, its answer and its dashboard) to a PDF and a PowerPoint the user downloads and shares. You write its title, summary and headlines from the answers; your team does no new work for it. Only available when the user asked to export or share the conversation.';

/** Her export rule, the last of her Rules: it fires on the request's own words. */
export const EXPORT_RULE =
  '- Export the conversation only when the user asks to export, download or share it (a PDF, a PowerPoint, slides, a report): then read the export playbook and call export_conversation. Every figure you write for it is copied from an answer; never call the team to re-analyse for an export.';

/**
 * Avery's job description with the export (agents.md 2.21): the team line
 * before ask_clarification (at the end when an edited prompt has no such
 * line) and the rule last. Only a run whose gate is open gets it, so a run
 * that is not an export sends her what it sent before.
 */
export function withExportInstructions(instructions: string): string {
  const lines = instructions.trimEnd().split('\n');
  const at = lines.findIndex((line) => line.startsWith('- ask_clarification'));
  if (at < 0)
    return `${[...lines, EXPORT_TEAM_LINE, EXPORT_RULE].join('\n')}\n`;
  lines.splice(at, 0, EXPORT_TEAM_LINE);
  return `${[...lines, EXPORT_RULE].join('\n')}\n`;
}

/** Michael on his own (Avery + Michael): told he plans and writes the answer. */
export const MICHAEL_ALONE_LINE =
  'You work alone with Avery in this run: no one plans before you and no one writes after you. Plan the analysis yourself from her brief, and write your reply as the answer the user reads.';

/** The plan Michael works from on his own: the user's question, nothing planned. */
export function briefPlan(question: string): AnalysisPlan {
  return {
    question,
    measures: [],
    entities: [],
    scope: '',
    assumptions: [],
    needsClarification: false,
    clarification: null,
  };
}

/**
 * Michael's request on his own (agents.md 5.23), the block after the
 * catalog's: Avery's brief, the line that says he plans and writes the
 * answer, then the queries behind the last answer when there are some
 * (`earlier`, '' when none).
 */
export function michaelAloneRequest(brief: string, earlier = ''): string {
  return [
    `Brief from Avery, the Chief of Staff: ${brief}`,
    '',
    MICHAEL_ALONE_LINE,
    ...(earlier ? ['', earlier] : []),
  ].join('\n');
}

/** A list in the plan's Markdown, or `none` when it is empty. */
function reviewList(items: readonly string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- none'];
}

/**
 * The plan Michael worked from, as a resumed Avery reads it in the work so
 * far (agents.md 5.23): the question as planned, the measures, entities,
 * scope and assumptions.
 */
export function planReview(plan: AnalysisPlan): string {
  return [
    `**Question:** ${plan.question}`,
    '',
    '**Measures**',
    ...reviewList(plan.measures),
    '',
    '**Entities**',
    ...reviewList(plan.entities),
    '',
    `**Scope:** ${plan.scope || 'none given'}`,
    '',
    '**Assumptions**',
    ...reviewList(plan.assumptions),
  ].join('\n');
}
