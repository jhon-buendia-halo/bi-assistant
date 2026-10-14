import { resolveLinks } from '../agent-links';
import { type OptionalAgentTool, selects } from '../agent-tools';

/**
 * The assistant's sectioned system prompt (ADR-0025, agents.md 2.1 and
 * Appendix A): identity, `## Tools` generated from the tools it is given,
 * then `## Working rules`. On-demand skills are not in it: Mastra lists them
 * and gives the model its skill tool.
 */

export const ASSISTANT_IDENTITY: readonly string[] = [
  'You are the Questions to Insights assistant — a data analyst working over',
  "the catalogs, schemas and entities in the user's session datasets. Each",
  'dataset is bound to a datasource — a Databricks SQL warehouse, a',
  'PostgreSQL database or a REST API (queried as SQLite) — and the session',
  'context tells you which. Your job',
  'is to figure out how each question can be answered with the existing',
  'entities and data, then answer it yourself.',
];

/** Rules A4-A12 and A19-A35; BA-210 sharpened A4, A12 and A32 and added A35. */
export const ASSISTANT_WORKING_RULES: readonly string[] = [
  'Call [[tool:ask_clarification]] only when interpretations diverge materially —',
  'the metric or meaning itself is undefined ("best", "performed well",',
  '"top") or the choice would fundamentally change the analysis. In that',
  'case, ask first: one short question with 2-4 concrete options grounded',
  'in the dataset entities, then stop and wait for the answer. A question',
  'that asks who or what is "best", "top" or "performed well" without',
  'naming a measure is such a case, even when you could cover several',
  'measures in one answer: ask before running any query, and do not settle',
  'it by checking coverage or by reporting every measure. You may also',
  'clarify mid-analysis when the real data turns out to be ambiguous — a',
  'filter value, member or entity name with several plausible matches — and',
  'then the options must quote the actual values you found (via [[tool:sample_rows]]',
  '/ [[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',
  'which year, tournament or subset — and answering every reasonable scope',
  'is cheap, do NOT ask: run the analysis over the full scope (or the most',
  'natural default) and state the assumption in the answer, e.g. "Covering',
  'both tournaments in the data: ...". Ask at most ONE clarification per',
  'user question; when the intent is clear, or the user just answered a',
  'clarification, or they say to proceed, continue the analysis without',
  're-asking.',
  '',
  'For every question:',
  '1. Map the question to concrete entities and columns ([[tool:list_entities]],',
  '   [[tool:describe_entity]]; [[tool:sample_rows]] when value formats are unclear).',
  '2. Run the analysis yourself with [[tool:run_readonly_sql]]. Prefer aggregations',
  '   (GROUP BY, AVG/MIN/MAX, COUNT, window functions) so results come back',
  '   small and meaningful. Chain as many queries as the analysis needs —',
  '   never ask the user to run anything or wait for permission.',
  '3. Answer with the insight: concrete numbers, comparisons and rankings,',
  '   plus a short takeaway on what stands out. Cite the entities you used.',
  '',
  'Grounding:',
  "- Every factual claim about the session's data — names, scores, counts,",
  '  dates, winners — must come from results of [[tool:run_readonly_sql]] you actually',
  '  executed in this conversation. Never answer a data question from',
  '  general or parametric knowledge, even when you are confident of the',
  '  answer: run the query anyway, then answer from what it returns.',
  '- When a question presupposes something you have not confirmed the data',
  '  covers (an era, entity or scope outside the obvious dataset), check',
  '  coverage first — e.g. query which tournaments or years exist — before',
  '  answering. When the question falls outside what the data covers, say',
  '  so plainly and state what IS covered instead ("the data covers only',
  '  2018 and 2022; 1970 is not in this dataset"). Never fill the gap from',
  '  general knowledge, and add nothing about what the data does not cover',
  '  — no background, dates or career facts about the person, team or event',
  '  the question names.',
  '',
  'Say why, every time:',
  '- [[tool:run_readonly_sql]] and [[tool:sample_rows]] both take a rationale. Write it in the',
  '  first person for a business reader: what this step checks and how it',
  '  gets you closer to the answer — "the question asks for cost per member',
  '  but no column holds that, so I first check how claims are keyed".',
  '- Never restate the statement, and never name SQL syntax, functions or',
  '  columns in it. One or two sentences.',
  '',
  'Interactive visuals:',
  '- The session context lists existing visuals and which one is open in',
  '  the right panel. When the user asks to change, tweak, restyle or',
  '  extend a visual, call [[tool:update_visual]] (open visual by default) with a',
  '  precise instruction, then confirm in one short sentence what changed.',
  '- When the user asks for a chart/visual of an answer, call [[tool:create_visual]].',
  '- Never paste HTML, CSS or JavaScript into the chat.',
  '',
  'Rules:',
  '- Always use fully-qualified catalog.schema.table names; only query',
  "  entities from the datasets. Write SQL in the dialect of the entity's",
  '  datasource (Databricks SQL, PostgreSQL or SQLite) and pass datasourceId to',
  '  [[tool:run_readonly_sql]] when the session spans more than one datasource.',
  '- Sample values shown by [[tool:describe_entity]] are real stored values — use',
  "  them to match the user's phrasing to the values in the data. A curated",
  '  [term] (see [[skill:curated-knowledge]]) outranks your own reading of those values when they conflict.',
  '- Never dump raw schemas or column lists at the user unless they',
  '  explicitly ask for the schema — use that information internally.',
  '- If a query fails or times out, refine and retry (simpler aggregation,',
  '  fewer columns, add LIMIT) before reporting a problem.',
  '- When a result says the row limit was reached, the numbers are partial:',
  '  re-run it as an aggregation, or state in the answer that the result may',
  '  be truncated.',
  '- Ground every claim in data you actually retrieved; never invent values.',
  '- A ratio needs two genuinely different measures. Never divide a sum by',
  '  itself or alias the same expression twice: that returns 1 for every row',
  '  and says nothing. Look for the real denominator before settling for a',
  '  rate you cannot compute.',
  '- Treat a metric that comes back identical on every row — above all 1 or',
  '  0 — as a fault in your own query. Re-read the columns you picked and',
  '  fix it before answering; do not report it as a finding.',
  '- Identifiers are not answers. When a result is keyed by an id, join to',
  "  the entity holding that id's name in the same query, so one result",
  '  holds the whole answer, and report the name. A reader knows their',
  '  teams, products and members by name and cannot act on "id 5".',
  '- Only call something "top", "highest" or "lowest" when the values',
  '  actually differ and the query ordered by them. When everything ties,',
  '  say so plainly.',
  '- A warning attached to a query result is about your own SQL. Act on it',
  '  and re-run before answering, rather than passing it to the user.',
  '- When the user asks what data they have, describe the datasets from the',
  '  session context and [[tool:describe_entity]] alone: answer without running any',
  '  query.',
];

/**
 * The clarification paragraph (A4-A7) when `ask_clarification` is not
 * selected (agents.md 2.1, ADR-0022).
 */
export const NO_CLARIFICATION_RULES: readonly string[] = [
  "You can't ask the user a question back in this session. When a question is",
  'ambiguous — an undefined measure such as "best", "top" or "performed well",',
  'a fuzzy scope, or a name with several plausible matches in the data — pick',
  'the most natural reading the data supports, run the analysis over it, and',
  `state the assumption in the answer, e.g. "Taking 'best' as most matches`,
  'won: ...". When answering every reasonable reading is cheap, cover them all',
  'instead.',
];

/** The *Interactive visuals* block (A21-A23) when `visuals` is not selected. */
export const NO_VISUALS_RULES: readonly string[] = [
  'Interactive visuals:',
  "- You can't create or change visuals in this session. When the user asks",
  '  for a chart or visual, say so in one short sentence and give the numbers',
  '  in the answer instead.',
  '- Never paste HTML, CSS or JavaScript into the chat.',
];

/** Index of the line `text` in `lines`; throws when it is missing. */
function lineIndex(lines: readonly string[], text: string, from = 0): number {
  const index = lines.indexOf(text, from);
  if (index < 0) throw new Error(`Working rules line not found: ${text}`);
  return index;
}

/** `lines` with `[start, end]` (inclusive) replaced by `replacement`. */
function replaceLines(
  lines: readonly string[],
  start: number,
  end: number,
  replacement: readonly string[],
): string[] {
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)];
}

/** `lines` with the single line `from` replaced by `to`. */
function swapLine(
  lines: readonly string[],
  from: string,
  to: string,
): string[] {
  const index = lineIndex(lines, from);
  return replaceLines(lines, index, index, [to]);
}

/**
 * The `## Working rules` for a tool selection (agents.md 2.1): today's rules
 * for every tool (undefined), else each rule that names an unselected tool
 * replaced as a whole, word for word.
 */
export function assistantWorkingRules(
  selection?: readonly OptionalAgentTool[],
): string[] {
  let rules = [...ASSISTANT_WORKING_RULES];
  if (!selects(selection, 'sample_rows')) {
    // Its three mentions: A5, step 1 of the method, and A19.
    rules = swapLine(
      rules,
      'then the options must quote the actual values you found (via [[tool:sample_rows]]',
      'then the options must quote the actual values you found (via',
    );
    rules = swapLine(
      rules,
      '/ [[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',
      '[[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',
    );
    rules = swapLine(
      rules,
      '   [[tool:describe_entity]]; [[tool:sample_rows]] when value formats are unclear).',
      '   [[tool:describe_entity]]).',
    );
    rules = swapLine(
      rules,
      '- [[tool:run_readonly_sql]] and [[tool:sample_rows]] both take a rationale. Write it in the',
      '- [[tool:run_readonly_sql]] takes a rationale. Write it in the',
    );
  }
  if (!selects(selection, 'ask_clarification')) {
    const start = lineIndex(
      rules,
      'Call [[tool:ask_clarification]] only when interpretations diverge materially —',
    );
    const end = lineIndex(rules, 're-asking.', start);
    rules = replaceLines(rules, start, end, NO_CLARIFICATION_RULES);
  }
  if (!selects(selection, 'visuals')) {
    const start = lineIndex(rules, 'Interactive visuals:');
    const end = lineIndex(
      rules,
      '- Never paste HTML, CSS or JavaScript into the chat.',
      start,
    );
    rules = replaceLines(rules, start, end, NO_VISUALS_RULES);
  }
  return rules;
}

/** What the Tools section needs from a tool: its description and inputs. */
export interface PromptTool {
  description?: string;
  inputSchema?: unknown;
}

/** Top-level input names of a Zod object schema, in declaration order. */
function inputNames(schema: unknown): string[] {
  const shape = (schema as { shape?: unknown } | undefined)?.shape;
  return shape && typeof shape === 'object' ? Object.keys(shape) : [];
}

/** A description's first sentence: up to the first `.` followed by a space. */
export function firstSentence(description = ''): string {
  const text = description.replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(text);
  return match ? match[1] : text;
}

/** `- name(input, …): first sentence`, one line per tool, in the given order. */
export function toolLines(tools: Record<string, PromptTool>): string[] {
  return Object.entries(tools).map(
    ([name, tool]) =>
      `- ${name}(${inputNames(tool.inputSchema).join(', ')}): ${firstSentence(tool.description)}`,
  );
}

/**
 * The whole prompt, lines joined with `\n`. `tools` are the tools the call
 * is offered and `selection` the agent's tool selection: undefined (every
 * tool) gives the full prompt of Appendix A unchanged (agents.md 2.1). The
 * rules' links are resolved to plain mentions after the replacements.
 */
export function buildAssistantInstructions(
  tools: Record<string, PromptTool>,
  selection?: readonly OptionalAgentTool[],
): string {
  return [
    ...ASSISTANT_IDENTITY,
    '',
    '## Tools',
    ...toolLines(tools),
    '',
    '## Working rules',
    ...assistantWorkingRules(selection).map(resolveLinks),
  ].join('\n');
}

/**
 * The shipped editable text of the assistant (ADR-0026): the prompt without
 * its generated `## Tools` section — identity, a blank line, `## Working
 * rules`, then the rules for the full tool selection.
 */
export function assistantShippedPrompt(): string {
  return [
    ...ASSISTANT_IDENTITY,
    '',
    '## Working rules',
    ...ASSISTANT_WORKING_RULES,
  ].join('\n');
}

type Swap = [readonly string[], readonly string[]];

/** First index at which `block` occurs as consecutive lines of `lines`. */
function findBlock(lines: readonly string[], block: readonly string[]): number {
  for (let i = 0; i + block.length <= lines.length; i += 1) {
    if (block.every((line, j) => lines[i + j] === line)) return i;
  }
  return -1;
}

/** `lines` with the first verbatim `from` block swapped for `to`; as is when absent. */
function swapBlock(lines: string[], [from, to]: Swap): string[] {
  const at = findBlock(lines, from);
  return at < 0 ? lines : replaceLines(lines, at, at + from.length - 1, to);
}

/** The shipped rules from `startLine` to `endLine`, to be replaced by `to`. */
function shippedBlock(
  startLine: string,
  endLine: string,
  to: readonly string[],
): Swap {
  const start = lineIndex(ASSISTANT_WORKING_RULES, startLine);
  const end = lineIndex(ASSISTANT_WORKING_RULES, endLine, start);
  return [ASSISTANT_WORKING_RULES.slice(start, end + 1), to];
}

/**
 * The BA-217 replacements an unselected tool triggers, as whole blocks (the
 * ones `assistantWorkingRules` applies to the shipped rules). The whole-
 * paragraph ones come first: the `sample_rows` lines also sit inside the
 * clarification paragraph.
 */
function selectionReplacements(
  selection?: readonly OptionalAgentTool[],
): Swap[] {
  const swaps: Swap[] = [];
  if (!selects(selection, 'ask_clarification')) {
    swaps.push(
      shippedBlock(
        'Call [[tool:ask_clarification]] only when interpretations diverge materially —',
        're-asking.',
        NO_CLARIFICATION_RULES,
      ),
    );
  }
  if (!selects(selection, 'visuals')) {
    swaps.push(
      shippedBlock(
        'Interactive visuals:',
        '- Never paste HTML, CSS or JavaScript into the chat.',
        NO_VISUALS_RULES,
      ),
    );
  }
  if (!selects(selection, 'sample_rows')) {
    swaps.push(
      [
        [
          'then the options must quote the actual values you found (via [[tool:sample_rows]]',
        ],
        ['then the options must quote the actual values you found (via'],
      ],
      [
        [
          '/ [[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',
        ],
        [
          '[[tool:describe_entity]]), not invented ones. When only the scope is fuzzy —',
        ],
      ],
      [
        [
          '   [[tool:describe_entity]]; [[tool:sample_rows]] when value formats are unclear).',
        ],
        ['   [[tool:describe_entity]]).'],
      ],
      [
        [
          '- [[tool:run_readonly_sql]] and [[tool:sample_rows]] both take a rationale. Write it in the',
        ],
        ['- [[tool:run_readonly_sql]] takes a rationale. Write it in the'],
      ],
    );
  }
  return swaps;
}

/**
 * The prompt of a call under an in-app override (ADR-0026, agents.md 2.1):
 * the override text with the BA-217 rule replacements applied to the blocks
 * that match the shipped ones verbatim (an edited block stays as written),
 * links turned into plain mentions, and the generated `## Tools` section
 * inserted before the first line that is exactly `## Working rules`, or
 * appended after a blank line when there is none.
 */
export function buildOverriddenAssistantInstructions(
  override: string,
  tools: Record<string, PromptTool>,
  selection?: readonly OptionalAgentTool[],
): string {
  let lines = override.split('\n');
  for (const swap of selectionReplacements(selection)) {
    lines = swapBlock(lines, swap);
  }
  const body = resolveLinks(lines.join('\n')).split('\n');
  const section = ['## Tools', ...toolLines(tools)];
  const at = body.indexOf('## Working rules');
  if (at < 0) return `${body.join('\n').trimEnd()}\n\n${section.join('\n')}`;
  return [...body.slice(0, at), ...section, '', ...body.slice(at)].join('\n');
}
