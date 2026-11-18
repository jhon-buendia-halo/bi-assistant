/**
 * The turn workflow of Insights Analyst (ADR-0034; agents.md 5.11):
 * its step ids and titles, the edges between them, the contract between its
 * model steps and the session code, and the pure code of its deterministic
 * steps. Plain data and functions (its schemas are ./answer-business-question.schemas.ts),
 * no framework import, so the session code and the tests can read it without
 * loading Mastra; the workflow itself is built in ./answer-business-question.workflow.ts.
 */
import type { z } from 'zod';
import type {
  PageRequest,
  ResultView,
} from '../../modules/datasources/connectors/paged-sql.types';
import {
  explorerCandidateOfQuery,
  type ExplorableQuery,
} from '../../modules/sessions/query-evidence/explorable-queries';
import { coverageOf } from '../../modules/sessions/query-evidence/query-coverage';
import {
  pageCountOf,
  type ExplorerCandidate,
  type ExplorerSpec,
} from '../agents/result-explorer.prompts';
import { getDatasetToolServices } from '../tool-services';
import {
  ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
  answerSchema,
  planSchema,
  answerBusinessQuestionResultSchema,
  type analyseCallSchema,
  type analyseOutcomeSchema,
  type analyseQuerySchema,
  type answeredClarificationSchema,
  type catalogEntitySchema,
  type clarifyingQuestionSchema,
  type builtVisualSchema,
  type answerBusinessQuestionInputSchema,
  type entityColumnsSchema,
  type followUpSchema,
  type pagedResultSchema,
  type turnSummarySchema,
  type validateOutcomeSchema,
  type validationFindingSchema,
} from './answer-business-question.schemas';
import { readImagesEdges, readImagesStepEntry } from './read-images.steps';
import {
  contractJsonSchema,
  schemaFieldNames,
  type JsonSchema,
  type WorkflowEdge,
} from './workflow-contract';

export type { WorkflowEdge } from './workflow-contract';

/** The workflow's registry key and id. */
export const ANSWER_BUSINESS_QUESTION_WORKFLOW_ID = 'answer-business-question';

/**
 * The name the app shows for the workflow (workflows R1). Michael, the
 * `insights-analyst` agent, runs it; the agent and its prompts keep the name
 * Insights Analyst. A stored run keeps the name it ran under.
 */
export const ANSWER_BUSINESS_QUESTION_WORKFLOW_NAME =
  'Answer a Business Question';

/** How a step can end other than by passing its output on. */
export interface WorkflowStepExit {
  /**
   * The rest of the sentence the app writes about the exit, after `Fails
   * if`, `Ends if` or `Waits`: a condition in lower case with no
   * full stop (`the model returns an error`, `you stop it`); a `waits`
   * exit brings its own connector (`if it asks you a question`).
   */
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

const SCHEMAS = ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS;

const MODEL_EXITS: readonly WorkflowStepExit[] = [
  { label: 'the model returns an error', outcome: 'fails' },
  { label: 'you stop it', outcome: 'stops' },
];

/**
 * The steps, in catalogue order (Clarify after Plan): the session's
 * workflow bar shows them. Their field names and JSON Schemas come from
 * ./answer-business-question.schemas.ts; how they connect is `ANSWER_BUSINESS_QUESTION_EDGES`.
 */
export const ANSWER_BUSINESS_QUESTION_STEPS: readonly ContractStepEntry[] = [
  // Optional (the run's reference images, workflows R35): Zoe describes
  // them; Plan, Analyse and Write answer get her notes as text.
  readImagesStepEntry(),
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
      id: 'interpret-follow-up',
      title: 'Interpret follow-up',
      kind: 'agent',
      summary:
        "On a follow-up over an earlier result, Result Explorer's model reads whether the question asks for another page, a filter or an order of the earlier rows. A first run makes no model call. No tools.",
      // A model error is no failure: the run plans the question instead.
      exits: [{ label: 'you stop it', outcome: 'stops' }],
      modelOnly: true,
    },
    SCHEMAS['interpret-follow-up'],
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
      exits: [{ label: 'until you answer', outcome: 'waits' }],
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
        { label: 'if it asks you a question', outcome: 'waits' },
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
        "Checks the attempt's queries: one ran, no unresolved error, no result cut at its row limit, no answer from an arbitrary sample, the plan's measures covered. No LLM.",
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
      id: 'build-visual',
      title: 'Build visual',
      kind: 'agent',
      summary:
        "On unless the run turns it off (Build a visual): Ryan's model designs an interactive visual from the answer and the rows its queries returned, following Read images' notes when the run has reference images. No tools. Skipped when no query returned rows; a design that fails leaves the answer without a visual, never a failed run.",
      exits: [{ label: 'you stop it', outcome: 'stops' }],
      modelOnly: true,
    },
    SCHEMAS['build-visual'],
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
  contractStepEntry(
    {
      id: 'page-result',
      title: 'Page result',
      kind: 'code',
      summary:
        "Reads the page of the earlier query's full result the follow-up asks for, through the query inspector's page path. No LLM.",
      exits: [{ label: 'the page cannot be read', outcome: 'fails' }],
    },
    SCHEMAS['page-result'],
  ),
  contractStepEntry(
    {
      id: 'page-answer',
      title: 'Page answer',
      kind: 'code',
      summary:
        'Writes the answer from the page: which rows it shows, what was understood and a table of the rows. No LLM.',
      exits: [],
    },
    SCHEMAS['page-answer'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const ANSWER_BUSINESS_QUESTION_EDGES: readonly WorkflowEdge[] = [
  // Start → Receive question, or through Read images when the run has images.
  ...readImagesEdges('receive-question'),
  { from: 'receive-question', to: 'load-catalog', kind: 'next' },
  { from: 'load-catalog', to: 'interpret-follow-up', kind: 'next' },
  {
    from: 'interpret-follow-up',
    to: 'plan',
    kind: 'branch',
    label: 'New question',
    note: 'A question that needs a new analysis: plan it, query the data, write an answer.',
  },
  {
    from: 'interpret-follow-up',
    to: 'page-result',
    kind: 'branch',
    label: 'Explore the earlier result',
    note: 'A follow-up that only pages, filters or sorts the earlier answer’s rows. No new analysis.',
  },
  {
    from: 'plan',
    to: 'clarify',
    kind: 'branch',
    label: 'Needs clarification',
    note: 'The question can be read more than one way: the run waits for you to pick.',
  },
  {
    from: 'clarify',
    to: 'plan',
    kind: 'loop',
    label: 'Answered',
    note: 'Your answer goes back to Plan, which plans with it and never asks again.',
  },
  {
    from: 'plan',
    to: 'analyse',
    kind: 'branch',
    label: 'Clear',
    note: 'The plan is clear: the analyst queries the data.',
  },
  { from: 'analyse', to: 'validate', kind: 'next' },
  {
    from: 'validate',
    to: 'analyse',
    kind: 'loop',
    label: 'Retry once',
    note: 'A check failed: the analyst tries once more, told what failed.',
  },
  {
    from: 'validate',
    to: 'write-answer',
    kind: 'next',
    label: 'Valid or retried',
    note: 'The checks passed, or the retry is spent: the answer is written from the results.',
  },
  { from: 'write-answer', to: 'wrap-up', kind: 'next' },
  {
    from: 'write-answer',
    to: 'build-visual',
    kind: 'branch',
    label: 'Build a visual',
    note: 'On unless turned off: Ryan charts the rows behind the answer.',
  },
  { from: 'build-visual', to: 'wrap-up', kind: 'next' },
  { from: 'wrap-up', to: 'end', kind: 'next' },
  { from: 'page-result', to: 'page-answer', kind: 'next' },
  { from: 'page-answer', to: 'end', kind: 'next' },
];

/** The most attempts of the analysis loop: the first and one retry. */
export const ANALYSE_MAX_ATTEMPTS = 2;

/** The run's RequestContext key holding the per-run `AnswerBusinessQuestionRuntime`. */
export const ANSWER_BUSINESS_QUESTION_RUNTIME_KEY =
  'answer-business-question-runtime';

/**
 * The workflow's input: the question, the session's dataset names and,
 * only when the run has any, its reference images' stored paths.
 */
export type AnswerBusinessQuestionInput = z.output<
  typeof answerBusinessQuestionInputSchema
>;

/** One entity of the session's datasets, as the Load catalog step lists it. */
export type CatalogEntity = z.output<typeof catalogEntitySchema>;

/** One entity's columns, as Load catalog hands them to Plan. */
export type EntityColumns = z.output<typeof entityColumnsSchema>;

/** The analysis plan (PlanOutput). */
export type AnalysisPlan = z.output<typeof planSchema>;

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
export type BusinessAnswer = z.output<typeof answerSchema>;

/** What a waiting step (Clarify, Analyse) suspends the run with. */
export type ClarifyingQuestion = z.output<typeof clarifyingQuestionSchema>;

/** A clarifying question with the user's answer to it. */
export type AnsweredClarification = z.output<
  typeof answeredClarificationSchema
>;

/** The Wrap up step's summary: the run's result. */
export type AnswerBusinessQuestionSummary = z.output<typeof turnSummarySchema>;

/** What Build visual made: the run's visual, or why there is none. */
export type BuiltVisual = z.output<typeof builtVisualSchema>;

/** What Interpret follow-up read: the page of an earlier result asked for. */
export type FollowUp = z.output<typeof followUpSchema>;

/** One page of an earlier query's full result, as Page result passes it on. */
export type PagedFollowUp = z.output<typeof pagedResultSchema>;

/** What result-explorer reads (api.md 153's call): the words and the queries. */
export interface FollowUpRequest {
  text: string;
  candidates: ExplorerCandidate[];
  /** The latest query's view; null for its stored rows. */
  view: ResultView | null;
  pageCount: number | null;
}

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
export interface AnswerBusinessQuestionRuntime {
  /**
   * The Plan step's model call; `stopped` when the turn was stopped. After
   * Clarify, `clarification` holds its question and the user's answer.
   */
  plan(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    clarification?: AnsweredClarification;
    /** Read images' notes (agents.md 2.15); absent or `''` without images. */
    imageNotes?: string;
  }): Promise<{ plan: AnalysisPlan; stopped: boolean }>;
  /**
   * One attempt of the Analyse step: the agent turn with its tools. When
   * the step resumes after the agent's clarifying question, `answered`
   * holds it with the user's answer: the agent goes on from there.
   */
  analyse(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    plan: AnalysisPlan;
    attempt: number;
    planBlock: string;
    answered?: AnsweredClarification;
    /** Read images' notes (agents.md 2.15); absent or `''` without images. */
    imageNotes?: string;
    /**
     * Build visual runs after this turn and the request cues a visual
     * (`visualCued`): the agent is told a visual follows. Absent otherwise.
     */
    visualFollows?: true;
  }): Promise<AnalyseAttempt>;
  /**
   * Whether the run builds a visual (its input's `buildVisual`): the
   * condition of the branch to Build visual. Absent means no.
   */
  buildsVisual?: boolean;
  /**
   * Build visual (workflows R41): Ryan designs an interactive visual from
   * the answer and its queries' rows; it is stored with the run. It never
   * fails the run: a design that fails comes back as `error`.
   */
  buildVisual?(input: {
    question: string;
    answer: string;
    queries: AnalyseQuery[];
    /**
     * Read images' notes, the reference the designer follows; present only
     * when the run has some (not blank).
     */
    imageNotes?: string;
  }): Promise<{ visual: BuiltVisual; stopped: boolean }>;
  /** The Write answer step's model call; its text is the run's answer. */
  writeAnswer(input: {
    question: string;
    plan: AnalysisPlan;
    queries: AnalyseQuery[];
    findings: ValidationFinding[];
    /** Read images' notes (agents.md 2.15); absent or `''` without images. */
    imageNotes?: string;
    /**
     * Build visual runs after it and the request cues a visual
     * (`visualCued`): the request says a visual follows. Absent otherwise.
     */
    visualFollows?: true;
  }): Promise<{ answer: BusinessAnswer; stopped: boolean }>;
  /**
   * The run's earlier queries (roadmap 1.28.8): an earlier run's answer's
   * queries on a follow-up, a chat's earlier answers' queries. Absent or
   * empty on a first run: Interpret follow-up then makes no model call.
   */
  followUp?: readonly ExplorableQuery[];
  /**
   * Interpret follow-up's model call: result-explorer reads the words as a
   * view of one of the earlier queries; `stopped` when the turn was stopped.
   */
  interpretFollowUp?(
    input: FollowUpRequest,
  ): Promise<{ spec: ExplorerSpec | null; stopped: boolean }>;
  /**
   * Page result: the page of earlier query `query` (an index into
   * `followUp`) through the query inspector's page path, recorded as an
   * `explore_result` call of the turn. Throws the reason it cannot be read.
   */
  pageResult?(input: {
    query: number;
    request: PageRequest;
    understood: string;
  }): Promise<PagedFollowUp>;
  /** Page answer: the run's answer, written by code. */
  deliverAnswer?(answer: string): Promise<void>;
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
export function planOf(reply: unknown, question: string): AnalysisPlan {
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
export function answerOf(reply: unknown): BusinessAnswer {
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

/** The most rows of one query a table the code writes into the answer shows. */
export const ROW_TABLE_CAP = 200;

/** What starts every row marker (plan 1.25.6). */
const MARKER_START = '[[rows:';

/** A line that is a row marker: `[[rows:<n>]]` or `[[rows:<n> | col=Header, …]]`. */
const MARKER_LINE = /^\s*\[\[rows:\s*(\d+)\s*(?:\|([^\]\n]*))?\]\]\s*$/;

/** A row marker anywhere in a line. */
const MARKER_ANYWHERE = /\[\[rows:[^\]\n]*\]\]/g;

/** `total_race_starts` reads `Total race starts`. */
function readableColumn(name: string): string {
  const words = name.replace(/_+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/**
 * A cell as stored: only a pipe and a line break escaped; null is empty. A
 * Date (a page read straight from the pg driver) is its ISO instant, as
 * the stored rows hold it.
 */
function tableCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? String(value)
          : JSON.stringify(value);
  return raw.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

/** The columns of a result, in the order they first appear. */
function resultColumns(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** A Markdown table of the rows, written cell by cell: a header, then a row each. */
function markdownTable(
  columns: readonly { key: string; header: string }[],
  rows: readonly Record<string, unknown>[],
): string[] {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    line(columns.map((column) => tableCell(column.header))),
    line(columns.map(() => '---')),
    ...rows.map((row) =>
      line(columns.map((column) => tableCell(row[column.key]))),
    ),
  ];
}

/**
 * The lines a marker line becomes: the query's table (and the note when the
 * result has more rows than it shows), or none when the marker names no
 * query, a failed one or an empty result.
 */
function rowTableLines(
  number: number,
  spec: string | undefined,
  queries: readonly AnalyseQuery[],
): string[] {
  const query = number >= 1 ? queries[number - 1] : undefined;
  if (!query || query.error || !query.rows.length) return [];
  const rows = query.rows.slice(0, ROW_TABLE_CAP);
  const all = resultColumns(rows);
  const named = (spec ?? '')
    .split(',')
    .map((part) => {
      const at = part.indexOf('=');
      const key = (at < 0 ? part : part.slice(0, at)).trim();
      const header = at < 0 ? '' : part.slice(at + 1).trim();
      return { key, header: header || readableColumn(key) };
    })
    .filter((column) => column.key && all.includes(column.key));
  const columns = named.length
    ? named
    : all.map((key) => ({ key, header: readableColumn(key) }));
  const table = markdownTable(columns, rows);
  const total = Math.max(query.rowCount, query.rows.length);
  return total > rows.length
    ? [
        ...table,
        '',
        `Showing the first ${rows.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows. Open the query to download all of them.`,
      ]
    : table;
}

/**
 * Write answer's row markers expanded (plan 1.25.6, agents.md 5.11): each
 * line that is `[[rows:<n>]]` (optionally `| col=Header, …`) becomes a
 * Markdown table of query `n`'s rows (at most `ROW_TABLE_CAP`), written by
 * code cell by cell, set apart by blank lines; a marker it cannot expand,
 * and any marker inside a line, is removed. Each line is expanded on its
 * own, so the expansion of complete lines is a prefix of the whole one.
 */
export function expandRowTables(
  answer: string,
  queries: readonly AnalyseQuery[],
): string {
  if (!answer.includes(MARKER_START)) return answer;
  const lines = answer.split('\n');
  const out: string[] = [];
  lines.forEach((line, index) => {
    const marker = MARKER_LINE.exec(line);
    if (!marker) {
      out.push(line.replace(MARKER_ANYWHERE, ''));
      return;
    }
    const table = rowTableLines(Number(marker[1]), marker[2], queries);
    if (!table.length) return;
    if (index > 0 && lines[index - 1].trim()) out.push('');
    out.push(...table, '');
  });
  // A table that ends the answer leaves no blank line after it.
  if (out.length && out[out.length - 1] === '' && !answer.endsWith('\n')) {
    out.pop();
  }
  return out.join('\n');
}

/** The answer with its row markers expanded; the headline is never expanded, only cleaned. */
export function answerWithRowTables(
  answer: BusinessAnswer,
  queries: readonly AnalyseQuery[],
): BusinessAnswer {
  const expanded = expandRowTables(answer.answer, queries);
  const headline =
    answer.headline.replace(MARKER_ANYWHERE, '').replace(/\s+/g, ' ').trim() ||
    expanded
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('|'))
      .map((line) => line.replace(/^[#>*\s]+/, '').trim())
      .find(Boolean) ||
    '';
  return { headline, answer: expanded || headline };
}

/**
 * The part of an unfinished last line that may be shown: everything before
 * a row marker that has begun (or could be beginning), and nothing while the
 * line could still turn out to be a marker line.
 */
function shownOfOpenLine(line: string): string {
  const couldOpen = (rest: string) =>
    rest.startsWith(MARKER_START) || MARKER_START.startsWith(rest);
  if (!line.trim() || couldOpen(line.trimStart())) return '';
  for (let at = line.indexOf('['); at >= 0; at = line.indexOf('[', at + 1)) {
    if (couldOpen(line.slice(at))) return line.slice(0, at);
  }
  return line;
}

/**
 * The streamed answer (plan 1.25.6): `update` with the answer written so
 * far sends, through `onText`, only what is new of its complete lines with
 * their markers expanded (`expandRowTables`) and of its last line the part
 * before any marker that has begun; `finish` with the final, expanded
 * answer sends the rest. The text sent is never taken back, so a marker,
 * whole or begun, never reaches a reader.
 */
export function answerDeltas(
  queries: readonly AnalyseQuery[],
  onText: ((delta: string) => void) | undefined,
): {
  update: (partial: string) => void;
  finish: (answer: string) => void;
  sent: () => string;
} {
  let sent = '';
  const send = (full: string) => {
    if (!onText || !full.startsWith(sent) || full === sent) return;
    onText(full.slice(sent.length));
    sent = full;
  };
  return {
    update: (partial) => {
      const end = partial.lastIndexOf('\n') + 1;
      send(
        expandRowTables(partial.slice(0, end), queries) +
          shownOfOpenLine(partial.slice(end)),
      );
    },
    finish: send,
    sent: () => sent,
  };
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
  sample: 'No answer from a sample',
  measures: 'Measures covered (warning only)',
} as const;

/**
 * The Validate step (agents.md 5.11): code checks over one analysis
 * attempt's tool calls and queries. `ok` when at least one
 * `run_readonly_sql` call succeeded, every failed call was followed by a
 * successful call of the same tool, and every query cut at its row limit was
 * followed by a successful query that was not, and every query that kept an
 * arbitrary sample (`coverageOf`: its own LIMIT reached with no sort before
 * it) was followed by a successful query that did not (plan 1.25.7). The
 * plan's measures are
 * looked for (best effort: a word of each in some successful query's SQL,
 * rationale or columns) and reported as a warning that never fails the
 * attempt.
 */
export function validateAttempt(input: {
  plan: AnalysisPlan;
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
  const isSample = (query: AnalyseQuery) =>
    coverageOf({
      tool: 'run_readonly_sql',
      sql: query.sql,
      rowCount: query.rowCount,
      truncated: query.truncated,
    }) === 'sample';
  const sampled = queries.filter(
    (query, index) =>
      !query.error &&
      isSample(query) &&
      !queries
        .slice(index + 1)
        .some((later) => !later.error && !isSample(later)),
  );
  const sample: ValidationFinding = {
    check: VALIDATION_CHECKS.sample,
    passed: sampled.length === 0,
    detail: sampled.length
      ? `${sampled.length} ${sampled.length === 1 ? 'result' : 'results'} kept an arbitrary sample of rows (a LIMIT with no sort) and no later query read the whole data.`
      : 'No result the answer reads is an arbitrary sample.',
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
    ok:
      ranQuery.passed && noToolError.passed && rowLimit.passed && sample.passed,
    findings: [ranQuery, noToolError, rowLimit, sample, measures],
  };
}

/**
 * The plan after the user answered Clarify (agents.md 5.11): Plan never
 * asks twice, so a plan made with an answer needs no clarification, whatever
 * the model replied.
 */
export function planAfterAnswer(
  plan: AnalysisPlan,
  answered: AnsweredClarification | undefined,
): AnalysisPlan {
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
    (outcome.attempt ?? 0) >= ANALYSE_MAX_ATTEMPTS
  );
}

/** Wrap up: the last attempt's `run_readonly_sql` calls, their rows, the answer. */
export function wrapUp(
  calls: readonly AnalyseCall[],
  answer: string,
): AnswerBusinessQuestionSummary {
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

/**
 * Whether the answer has something to chart (workflows R41): a query that
 * ran without error and returned rows. Build visual is skipped otherwise.
 */
export function chartableQueries(queries: readonly AnalyseQuery[]): boolean {
  return queries.some((query) => !query.error && query.rowCount > 0);
}

/**
 * The run's summary, when the run got that far: Page answer's on a
 * follow-up over an earlier result, else Wrap up's.
 */
export function turnSummaryOf(
  result: unknown,
): AnswerBusinessQuestionSummary | undefined {
  const parsed = answerBusinessQuestionResultSchema.safeParse(result);
  if (!parsed.success) return undefined;
  return (
    parsed.data['explore-result'] ??
    parsed.data['question-path']?.['analysis-path']?.['answer-path']
  );
}

/**
 * Interpret follow-up (roadmap 1.28.8): a code gate, then at most one
 * result-explorer call. A run without earlier queries (every first run,
 * every eval case) makes no model call and plans as before. Otherwise the
 * words are read against every earlier query, from the latest one's view:
 * a view of one of them is the follow-up; a new question, a part that
 * names no known column, or a model error is none (the run plans the
 * question, it never fails here).
 */
export async function interpretFollowUp(
  question: string,
  runtime:
    | Pick<AnswerBusinessQuestionRuntime, 'followUp' | 'interpretFollowUp'>
    | undefined,
): Promise<{ followUp: FollowUp | null; stopped: boolean }> {
  const queries = runtime?.followUp ?? [];
  const none = { followUp: null, stopped: false };
  if (!queries.length || !runtime?.interpretFollowUp) return none;
  const latest = queries[queries.length - 1];
  const view = latest.view ?? null;
  let read: { spec: ExplorerSpec | null; stopped: boolean };
  try {
    read = await runtime.interpretFollowUp({
      text: question,
      candidates: queries.map(explorerCandidateOfQuery),
      view,
      pageCount: pageCountOf(view),
    });
  } catch {
    return none;
  }
  if (read.stopped) return { followUp: null, stopped: true };
  const { spec } = read;
  if (
    !spec ||
    spec.action !== 'explore' ||
    spec.interpretation.rejected?.length
  ) {
    return none;
  }
  const index = queries[spec.query] ? spec.query : queries.length - 1;
  return {
    followUp: {
      action: 'explore',
      query: index,
      ref: queries[index].ref,
      request: spec.interpretation.request,
      understood: spec.interpretation.understood,
    },
    stopped: false,
  };
}

/** `1264` reads `1,264`. */
function count(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * The page's headline, in the query inspector's words (plan 0.5):
 * `Rows 51–100 of 2,034`, `Rows 1–50 of 312 matching`, `Rows 1–50 of
 * 50,000+`; `No rows match these filters.` when none does.
 */
function pageHeadline(
  view: ResultView,
  shown: number,
  matchedRows: number,
  capped: boolean,
): string {
  const filtered = view.filters.length > 0;
  if (!shown) {
    return filtered
      ? 'No rows match these filters.'
      : 'The result has no rows.';
  }
  const first = (Math.max(1, view.page) - 1) * view.pageSize + 1;
  const last = first + shown - 1;
  return `Rows ${count(first)}–${count(last)} of ${count(matchedRows)}${capped ? '+' : ''}${filtered ? ' matching' : ''}`;
}

/**
 * Page answer (roadmap 1.28.8): the run's answer from one page of an
 * earlier query's result, written by code: the headline (which rows, of
 * how many), the query and what the words were understood as, a Markdown
 * table of the page's rows, and where the page sits.
 */
export function pageAnswer(
  view: ResultView,
  result: Pick<
    PagedFollowUp,
    'columns' | 'rows' | 'pageCount' | 'matchedRows' | 'capped' | 'understood'
  >,
  queryTitle: string,
): string {
  const lines = [
    pageHeadline(view, result.rows.length, result.matchedRows, result.capped),
    '',
    `Query: ${queryTitle}`,
    `Understood as: ${result.understood}`,
  ];
  if (!result.rows.length) return lines.join('\n');
  const columns = (
    result.columns.length ? result.columns : resultColumns(result.rows)
  ).map((key) => ({ key, header: readableColumn(key) }));
  lines.push(
    '',
    ...markdownTable(columns, result.rows),
    '',
    `Page ${count(view.page)} of ${count(result.pageCount)}. Open the query to page, filter or sort the full result.`,
  );
  return lines.join('\n');
}
