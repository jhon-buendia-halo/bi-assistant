/**
 * The turn workflow of Questions to Insights v2 (ADR-0034; agents.md 5.11):
 * its step ids and titles, the edges between them, the contract between its
 * model steps and the session code, and the pure code of its deterministic
 * steps. Plain data and functions (its schemas are ./qti-v2-turn.schemas.ts),
 * no framework import, so the session code and the tests can read it without
 * loading Mastra; the workflow itself is built in ./qti-v2-turn.workflow.ts.
 */
import type { z } from 'zod';
import { getDatasetToolServices } from '../tool-services';
import {
  QTI_V2_TURN_STEP_SCHEMAS,
  answerSchema,
  planSchema,
  qtiV2TurnResultSchema,
  type analyseCallSchema,
  type analyseOutcomeSchema,
  type analyseQuerySchema,
  type answeredClarificationSchema,
  type catalogEntitySchema,
  type clarifyingQuestionSchema,
  type entityColumnsSchema,
  type turnInputSchema,
  type turnSummarySchema,
  type validateOutcomeSchema,
  type validationFindingSchema,
} from './qti-v2-turn.schemas';
import {
  contractJsonSchema,
  schemaFieldNames,
  type JsonSchema,
  type WorkflowEdge,
} from './workflow-contract';

export type { WorkflowEdge } from './workflow-contract';

/** The workflow's registry key and id. */
export const QTI_V2_TURN_WORKFLOW_ID = 'qti-v2-turn';

/**
 * The name the app shows for the workflow (workflows R1). Michael, the
 * `assistant-v2` agent, runs it; the agent and its prompts keep the name
 * Questions to Insights v2. A stored run keeps the name it ran under.
 */
export const QTI_V2_TURN_WORKFLOW_NAME = 'Answer a Business Question';

/** How a step can end other than by passing its output on. */
export interface WorkflowStepExit {
  label: string;
  /**
   * `fails`: the run stops with an error; `stops`: it ends early; `waits`:
   * the run is suspended until the user answers (api.md 138).
   */
  outcome: 'fails' | 'stops' | 'waits';
}

/**
 * One step of a code-defined turn workflow, as the step catalogue describes
 * it (agents.md 5.11): the workflow bar reads `id` and `title`, the agent's
 * Graph tab all of it (agents-evals R108). `input` and `output` name the
 * fields of the step's schemas, in schema order: a catalogued workflow's
 * steps derive them from their declared schemas (`inputSchema`,
 * `outputSchema`; agents.md 5.12).
 */
export interface WorkflowStepEntry {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  summary: string;
  input: readonly string[];
  output: readonly string[];
  exits: readonly WorkflowStepExit[];
  /**
   * An agent step that calls its agent's model without its tools (Plan,
   * Write answer): its own tools (none) and its one model call.
   */
  modelOnly?: true;
  /** The step's declared input, as JSON Schema (catalogued workflows). */
  inputSchema?: JsonSchema;
  /** The step's declared output, as JSON Schema (catalogued workflows). */
  outputSchema?: JsonSchema;
}

/** A catalogued step: its field names and JSON Schemas derived from its Zod schemas. */
export type ContractStepEntry = WorkflowStepEntry & {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

/** A step's catalogue entry from its description and its declared schemas. */
export function contractStepEntry(
  step: Omit<
    WorkflowStepEntry,
    'input' | 'output' | 'inputSchema' | 'outputSchema'
  >,
  schemas: { input: z.ZodType; output: z.ZodType },
): ContractStepEntry {
  const inputSchema = contractJsonSchema(schemas.input, 'input');
  const outputSchema = contractJsonSchema(schemas.output, 'output');
  return {
    ...step,
    input: schemaFieldNames(inputSchema),
    output: schemaFieldNames(outputSchema),
    inputSchema,
    outputSchema,
  };
}

const SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS;

const MODEL_EXITS: readonly WorkflowStepExit[] = [
  { label: 'Model error', outcome: 'fails' },
  { label: 'Stop', outcome: 'stops' },
];

/**
 * The steps, in catalogue order (Clarify after Plan): the session's
 * workflow bar shows them. Their field names and JSON Schemas come from
 * ./qti-v2-turn.schemas.ts; how they connect is `QTI_V2_TURN_EDGES`.
 */
export const QTI_V2_TURN_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      summary:
        'Trims the question. The input node has checked it before the run.',
      exits: [],
    },
    SCHEMAS['receive-question'],
  ),
  contractStepEntry(
    {
      id: 'load-catalog',
      title: 'Load catalog',
      kind: 'code',
      summary: "Lists the entities of the session's datasets. No LLM.",
      exits: [],
    },
    SCHEMAS['load-catalog'],
  ),
  contractStepEntry(
    {
      id: 'plan',
      title: 'Plan',
      kind: 'agent',
      summary:
        "The agent's model plans the analysis: measures, entities, scope, assumptions, and whether to clarify first. No tools.",
      exits: MODEL_EXITS,
      modelOnly: true,
    },
    SCHEMAS.plan,
  ),
  contractStepEntry(
    {
      id: 'clarify',
      title: 'Clarify',
      kind: 'code',
      summary:
        "Waits for the user's answer to the plan's clarifying question, then hands it back to Plan. No LLM.",
      exits: [{ label: 'Waits for an answer', outcome: 'waits' }],
    },
    SCHEMAS.clarify,
  ),
  contractStepEntry(
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary:
        'The agent runs the planned analysis with its tools and the catalog as context. Its text is a note, not the answer.',
      // A clarifying question makes the run wait for the user's answer;
      // the agent then goes on with it (agents.md 5.11, api.md 138).
      exits: [
        ...MODEL_EXITS,
        { label: 'Clarifying question', outcome: 'waits' },
      ],
    },
    SCHEMAS.analyse,
  ),
  contractStepEntry(
    {
      id: 'validate',
      title: 'Validate',
      kind: 'code',
      summary:
        "Checks the attempt's queries: one ran, no unresolved error, no result cut at its row limit, the plan's measures covered. No LLM.",
      exits: [],
    },
    SCHEMAS.validate,
  ),
  contractStepEntry(
    {
      id: 'write-answer',
      title: 'Write answer',
      kind: 'agent',
      summary:
        "The agent's model writes the run's answer from the queries' rows and the findings. No tools.",
      exits: MODEL_EXITS,
      modelOnly: true,
    },
    SCHEMAS['write-answer'],
  ),
  contractStepEntry(
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      summary:
        "Counts the answer's SQL queries, failed queries and rows, and logs the summary.",
      exits: [],
    },
    SCHEMAS['wrap-up'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const QTI_V2_TURN_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'receive-question', kind: 'next' },
  { from: 'receive-question', to: 'load-catalog', kind: 'next' },
  { from: 'load-catalog', to: 'plan', kind: 'next' },
  { from: 'plan', to: 'clarify', kind: 'branch', label: 'Needs clarification' },
  { from: 'clarify', to: 'plan', kind: 'loop', label: 'Answered' },
  { from: 'plan', to: 'analyse', kind: 'branch', label: 'Clear' },
  { from: 'analyse', to: 'validate', kind: 'next' },
  { from: 'validate', to: 'analyse', kind: 'loop', label: 'Retry once' },
  {
    from: 'validate',
    to: 'write-answer',
    kind: 'next',
    label: 'Valid or retried',
  },
  { from: 'write-answer', to: 'wrap-up', kind: 'next' },
  { from: 'wrap-up', to: 'end', kind: 'next' },
];

/** The most attempts of the analysis loop: the first and one retry. */
export const QTI_V2_MAX_ATTEMPTS = 2;

/** The run's RequestContext key holding the per-run `QtiV2TurnRuntime`. */
export const QTI_V2_TURN_RUNTIME_KEY = 'qti-v2-turn-runtime';

/** The workflow's input: the question and the session's dataset names. */
export type QtiV2TurnInput = z.output<typeof turnInputSchema>;

/** One entity of the session's datasets, as the Load catalog step lists it. */
export type CatalogEntity = z.output<typeof catalogEntitySchema>;

/** One entity's columns, as Load catalog hands them to Plan. */
export type EntityColumns = z.output<typeof entityColumnsSchema>;

/** The analysis plan (PlanOutput). */
export type QtiV2Plan = z.output<typeof planSchema>;

/** One tool call of the turn, as the Analyse step reports it. */
export type AnalyseCall = z.output<typeof analyseCallSchema>;

/** One SQL query of an analysis attempt, with its rows. */
export type AnalyseQuery = z.output<typeof analyseQuerySchema>;

/** What the Analyse step returns; `stopped`: the run ends after Analyse. */
export type AnalyseOutcome = z.output<typeof analyseOutcomeSchema>;

/** A turn's tool calls and whether it ended early (an agent turn's outcome). */
export type TurnCallsOutcome = Pick<AnalyseOutcome, 'calls' | 'stopped'>;

/** One validation check. */
export type ValidationFinding = z.output<typeof validationFindingSchema>;

/** What the Validate step passes on. */
export type ValidateOutcome = z.output<typeof validateOutcomeSchema>;

/** The answer (AnswerOutput). */
export type QtiV2Answer = z.output<typeof answerSchema>;

/** What a waiting step (Clarify, Analyse) suspends the run with. */
export type ClarifyingQuestion = z.output<typeof clarifyingQuestionSchema>;

/** A clarifying question with the user's answer to it. */
export type AnsweredClarification = z.output<
  typeof answeredClarificationSchema
>;

/** The Wrap up step's summary: the run's result. */
export type QtiV2TurnSummary = z.output<typeof turnSummarySchema>;

/**
 * What one analysis attempt of the agent turn gives back; `clarification`
 * when the agent asked the user a clarifying question (`ask_clarification`):
 * the Analyse step then waits for the answer (api.md 138).
 */
export type AnalyseAttempt = Pick<
  AnalyseOutcome,
  'calls' | 'queries' | 'text' | 'stopped'
> & { clarification?: ClarifyingQuestion };

/**
 * What the session code (or the eval runner) hands the run, on its
 * RequestContext: the model steps call back into it, so the chat sees the
 * turn as today (agents.md 5.11).
 */
export interface QtiV2TurnRuntime {
  /**
   * The Plan step's model call; `stopped` when the turn was stopped. After
   * Clarify, `clarification` holds its question and the user's answer.
   */
  plan(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    clarification?: AnsweredClarification;
  }): Promise<{ plan: QtiV2Plan; stopped: boolean }>;
  /**
   * One attempt of the Analyse step: the agent turn with its tools. When
   * the step resumes after the agent's clarifying question, `answered`
   * holds it with the user's answer: the agent goes on from there.
   */
  analyse(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    plan: QtiV2Plan;
    attempt: number;
    planBlock: string;
    answered?: AnsweredClarification;
  }): Promise<AnalyseAttempt>;
  /** The Write answer step's model call; its text is the run's answer. */
  writeAnswer(input: {
    question: string;
    plan: QtiV2Plan;
    queries: AnalyseQuery[];
    findings: ValidationFinding[];
  }): Promise<{ answer: QtiV2Answer; stopped: boolean }>;
}

/**
 * Step 1: the trimmed question. It never fails: the run's input was checked
 * as a whole before the run (api.md 118, 119), so a blank question never
 * reaches it.
 */
export function receiveQuestion(question: string): string {
  return (question ?? '').trim();
}

/** The most columns of one entity Load catalog hands Plan. */
export const PLAN_COLUMNS_PER_ENTITY = 40;

/** The most columns in all Load catalog hands Plan. */
export const PLAN_COLUMNS_TOTAL = 400;

/**
 * Step 2: the entities of the session's datasets, read through the dataset
 * tools' own services, in dataset then table order, and the columns of each
 * as the datasets record them (name and type; at most
 * `PLAN_COLUMNS_PER_ENTITY` per entity and `PLAN_COLUMNS_TOTAL` in all, the
 * rest counted in `more`), so Plan can ground its measures in them. No LLM.
 */
export async function loadCatalog(datasets: readonly string[]): Promise<{
  catalog: CatalogEntity[];
  columns: EntityColumns[];
}> {
  const snapshots = await getDatasetToolServices().getDatasets([...datasets]);
  const catalog: CatalogEntity[] = [];
  const columns: EntityColumns[] = [];
  let room = PLAN_COLUMNS_TOTAL;
  for (const dataset of snapshots) {
    for (const entity of dataset.tables) {
      const known =
        dataset.entities?.find((e) => e.key === entity)?.columns ?? null;
      catalog.push({
        entity,
        dataset: dataset.name,
        datasourceId: dataset.datasourceId ?? null,
        datasourceKind: dataset.datasourceKind ?? null,
        columnCount: known ? known.length : null,
      });
      if (!known) continue;
      const listed = known
        .slice(0, Math.min(PLAN_COLUMNS_PER_ENTITY, room))
        .map((column) => ({ name: column.name, type: column.type ?? '' }));
      room -= listed.length;
      columns.push({
        entity,
        columns: listed,
        more: known.length - listed.length,
      });
    }
  }
  return { catalog, columns };
}

/**
 * The catalog with each entity's columns, as Plan's request carries it
 * (agents.md 5.11): the catalog block, then `Columns of each entity (name
 * type):` and one line per entity with its listed columns and, when some
 * were left out, how many.
 */
export function planCatalogBlock(
  catalog: readonly CatalogEntity[],
  columns: readonly EntityColumns[],
): string {
  const lines = columns.map((entry) => {
    const listed = entry.columns
      .map((column) => `${column.name}${column.type ? ` ${column.type}` : ''}`)
      .join(', ');
    const more = entry.more ? ` (+${entry.more} more not listed)` : '';
    return `- ${entry.entity}: ${listed || '(none listed)'}${more}`;
  });
  return [
    catalogBlock(catalog),
    ...(lines.length
      ? ['', 'Columns of each entity (name type):', ...lines]
      : ['', 'No columns are known for these entities.']),
  ].join('\n');
}

/** The catalog as the Plan and Analyse steps' system message (agents.md 5.11). */
export function catalogBlock(catalog: readonly CatalogEntity[]): string {
  if (!catalog.length) return 'Catalog loaded for this turn: no entities.';
  return [
    `Catalog loaded for this turn: ${catalog.length} ${catalog.length === 1 ? 'entity' : 'entities'}.`,
    ...catalog.map(
      (e) =>
        `- ${e.entity} (dataset: ${e.dataset}; ${e.columnCount ?? '?'} columns)`,
    ),
  ].join('\n');
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The first JSON object in a model's reply, fences and prose around it allowed. */
export function jsonObjectOf(reply: unknown): unknown {
  if (reply && typeof reply === 'object') return reply;
  if (typeof reply !== 'string') return undefined;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * The Plan step's plan from its model's reply (agents.md 5.11), read
 * leniently: missing lists are empty, a missing restatement is the
 * question; `needsClarification` holds only with a clarification of a
 * question and 2-4 options (else it is false and the clarification null).
 * A reply that is no JSON object plans nothing: the question as is.
 */
export function planOf(reply: unknown, question: string): QtiV2Plan {
  const raw = (jsonObjectOf(reply) ?? {}) as Record<string, unknown>;
  const asked = (raw['clarification'] ?? null) as Record<
    string,
    unknown
  > | null;
  const options = strings(asked?.['options']);
  const clarification =
    asked && text(asked['question']) && options.length >= 2
      ? { question: text(asked['question']), options: options.slice(0, 4) }
      : null;
  const needsClarification =
    raw['needsClarification'] === true && clarification !== null;
  return planSchema.parse({
    question: text(raw['question']) || question,
    measures: strings(raw['measures']),
    entities: strings(raw['entities']),
    scope: text(raw['scope']),
    assumptions: strings(raw['assumptions']),
    needsClarification,
    clarification: needsClarification ? clarification : null,
  });
}

/**
 * The Write answer step's answer from its model's reply (agents.md 5.11):
 * the JSON object's `answer` (Markdown) and `headline` (its first line when
 * missing). A reply that is no JSON object is the answer text itself.
 */
export function answerOf(reply: unknown): QtiV2Answer {
  const raw = jsonObjectOf(reply) as Record<string, unknown> | undefined;
  const answer = text(raw?.['answer']) || (raw ? '' : text(reply));
  const headline =
    text(raw?.['headline']) ||
    answer
      .split('\n')
      .map((line) => line.replace(/^[#>*\s]+/, '').trim())
      .find(Boolean) ||
    '';
  return answerSchema.parse({ headline, answer: answer || headline });
}

/** Lower-case words of at least four letters, a plural `s` dropped. */
function words(value: string): string[] {
  const found: string[] = value.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return found.map((word) => (word.endsWith('s') ? word.slice(0, -1) : word));
}

/** The check names Validate reports, in order. */
export const VALIDATION_CHECKS = {
  ranQuery: 'Ran a query',
  noToolError: 'No unresolved tool error',
  rowLimit: 'No result cut at its row limit',
  measures: 'Measures covered (warning only)',
} as const;

/**
 * The Validate step (agents.md 5.11): code checks over one analysis
 * attempt's tool calls and queries. `ok` when at least one
 * `run_readonly_sql` call succeeded, every failed call was followed by a
 * successful call of the same tool, and every query cut at its row limit was
 * followed by a successful query that was not. The plan's measures are
 * looked for (best effort: a word of each in some successful query's SQL,
 * rationale or columns) and reported as a warning that never fails the
 * attempt.
 */
export function validateAttempt(input: {
  plan: QtiV2Plan;
  calls: readonly AnalyseCall[];
  queries: readonly AnalyseQuery[];
}): { ok: boolean; findings: ValidationFinding[] } {
  const { plan, calls, queries } = input;
  const succeeded = queries.filter((query) => !query.error);
  const ranQuery: ValidationFinding = {
    check: VALIDATION_CHECKS.ranQuery,
    passed: succeeded.length > 0,
    detail: succeeded.length
      ? `${succeeded.length} of ${queries.length} SQL ${queries.length === 1 ? 'query' : 'queries'} succeeded.`
      : queries.length
        ? `None of the ${queries.length} SQL ${queries.length === 1 ? 'query' : 'queries'} succeeded.`
        : 'No SQL query ran.',
  };
  const unresolved = calls.filter(
    (call, index) =>
      call.failed &&
      !calls
        .slice(index + 1)
        .some((later) => later.tool === call.tool && !later.failed),
  );
  const noToolError: ValidationFinding = {
    check: VALIDATION_CHECKS.noToolError,
    passed: unresolved.length === 0,
    detail: unresolved.length
      ? `${unresolved.map((call) => call.tool).join(', ')} failed and was not run again successfully.`
      : calls.some((call) => call.failed)
        ? 'Every failed call was followed by a successful one.'
        : 'No tool call failed.',
  };
  const cut = queries.filter(
    (query, index) =>
      !query.error &&
      query.truncated &&
      !queries
        .slice(index + 1)
        .some((later) => !later.error && !later.truncated),
  );
  const rowLimit: ValidationFinding = {
    check: VALIDATION_CHECKS.rowLimit,
    passed: cut.length === 0,
    detail: cut.length
      ? `${cut.length} ${cut.length === 1 ? 'result was' : 'results were'} cut at the row limit and not aggregated again.`
      : 'No result the answer reads was cut.',
  };
  const haystack = new Set(
    succeeded.flatMap((query) =>
      words(
        [query.sql, query.rationale ?? '', ...Object.keys(query.rows[0] ?? {})]
          .join(' ')
          .replace(/_/g, ' '),
      ),
    ),
  );
  const missing = plan.measures.filter((measure) => {
    const wanted = words(measure);
    return wanted.length > 0 && !wanted.some((word) => haystack.has(word));
  });
  const measures: ValidationFinding = {
    check: VALIDATION_CHECKS.measures,
    passed: missing.length === 0,
    detail: !plan.measures.length
      ? 'The plan named no measure.'
      : missing.length
        ? `Not found in any query: ${missing.join('; ')}.`
        : 'Every planned measure appears in a query.',
  };
  return {
    ok: ranQuery.passed && noToolError.passed && rowLimit.passed,
    findings: [ranQuery, noToolError, rowLimit, measures],
  };
}

/**
 * The plan after the user answered Clarify (agents.md 5.11): Plan never
 * asks twice, so a plan made with an answer needs no clarification, whatever
 * the model replied.
 */
export function planAfterAnswer(
  plan: QtiV2Plan,
  answered: AnsweredClarification | undefined,
): QtiV2Plan {
  if (!answered || !plan.needsClarification) return plan;
  return { ...plan, needsClarification: false, clarification: null };
}

/**
 * Whether the plan loop ends after a round (agents.md 5.11): Plan's output
 * (a plan, needing no clarification or stopped) ends it; Clarify's (the
 * answer, no plan yet) sends the run back to Plan.
 */
export function planLoopDone(outcome: Record<string, unknown>): boolean {
  return (
    outcome['plan'] !== undefined && outcome['clarification'] === undefined
  );
}

/**
 * A waiting step's question from its suspend payload (agents.md 5.11): the
 * question and its options, the engine's own fields (`__workflow_meta`)
 * dropped; undefined when the payload holds no question.
 */
export function clarifyingQuestionOf(
  payload: unknown,
): ClarifyingQuestion | undefined {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const question = text(raw['question']);
  if (!question) return undefined;
  return { question, options: strings(raw['options']) };
}

/**
 * Whether the analysis loop ends after an attempt (agents.md 5.11): it was
 * stopped, it passed validation, or it was the last allowed attempt.
 */
export function analysisLoopDone(outcome: {
  ok?: boolean;
  attempt?: number;
  stopped?: boolean;
}): boolean {
  return (
    outcome.stopped === true ||
    outcome.ok === true ||
    (outcome.attempt ?? 0) >= QTI_V2_MAX_ATTEMPTS
  );
}

/** Wrap up: the last attempt's `run_readonly_sql` calls, their rows, the answer. */
export function wrapUp(
  calls: readonly AnalyseCall[],
  answer: string,
): QtiV2TurnSummary {
  const sql = calls.filter((call) => call.tool === 'run_readonly_sql');
  const failed = sql.filter((call) => call.failed);
  return {
    sqlQueries: sql.length,
    failedQueries: failed.length,
    rows: sql
      .filter((call) => !call.failed)
      .reduce((sum, call) => sum + (call.rowCount ?? 0), 0),
    answer,
  };
}

/** The Wrap up summary of a run's result, when the run got that far. */
export function turnSummaryOf(result: unknown): QtiV2TurnSummary | undefined {
  const parsed = qtiV2TurnResultSchema.safeParse(result);
  return parsed.success
    ? parsed.data['analysis-path']?.['answer-path']
    : undefined;
}
