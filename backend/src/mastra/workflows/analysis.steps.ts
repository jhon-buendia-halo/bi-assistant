/**
 * The turn workflow of Insights Analyst (ADR-0034; agents.md 5.11):
 * its step ids and titles, the edges between them, the contract between its
 * model steps and the session code, and the pure code of its deterministic
 * steps. Plain data and functions (its schemas are ./answer-business-question.schemas.ts),
 * no framework import, so the session code and the tests can read it without
 * loading Mastra; the workflow itself is built in ./answer-business-question.workflow.ts.
 */
import type { z } from 'zod';
import { coverageOf } from '../../modules/sessions/query-evidence/query-coverage';
import { getDatasetToolServices } from '../tool-services';
import {
  asksAboutToday,
  asksTimeRelative,
  dataEnd,
  isSnapshot,
  readsNow,
  sqlReadsTable,
} from '../data-dates';
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
  type questionInputSchema,
  type entityColumnsSchema,
  type turnSummarySchema,
  type validateOutcomeSchema,
  type validationFindingSchema,
} from './analysis.schemas';
import { readImagesEdges, readImagesStepEntry } from './read-images.steps';
import type { Revision } from './answer-business-question.review';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
  type WorkflowStepExit,
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

const SCHEMAS = ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS;

const MODEL_EXITS: readonly WorkflowStepExit[] = [
  { label: 'the model returns an error', outcome: 'fails' },
  { label: 'you stop it', outcome: 'stops' },
];

/** A step agent asks the user first (an interactive run, workflows R44). */
const ASKS_EXIT: WorkflowStepExit = {
  label: 'if it asks you a question',
  outcome: 'waits',
};

/** Its outcome waits on the approval gate (an interactive run, R44). */
const APPROVAL_EXIT: WorkflowStepExit = {
  label: 'until you approve its work',
  outcome: 'waits',
};

/**
 * The steps, in catalogue order, one line from Read images to Wrap up: the session's
 * workflow bar shows them. Their field names and JSON Schemas come from
 * ./answer-business-question.schemas.ts; how they connect is `ANSWER_BUSINESS_QUESTION_EDGES`.
 */
export const ANSWER_BUSINESS_QUESTION_STEPS: readonly ContractStepEntry[] = [
  // Optional (the run's reference images, workflows R35): Zoe describes
  // them; Plan, Analyse and Write answer get her notes as text.
  // In an interactive run (R44) Zoe may ask, and her notes wait for approval.
  readImagesStepEntry([ASKS_EXIT, APPROVAL_EXIT]),
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
        "The agent's model plans the analysis: measures, entities, scope and assumptions. When the question can be read more than one way, it asks you first and plans with your answer. No tools.",
      // Olivia asks in her own step: the run waits there for the answer
      // (since 2026-11-19 there is no Clarify step). In an interactive run
      // (R44) a clear plan waits for approval.
      exits: [...MODEL_EXITS, ASKS_EXIT, APPROVAL_EXIT],
      modelOnly: true,
    },
    SCHEMAS.plan,
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
        ASKS_EXIT,
        // In an interactive run (R44) each attempt waits for approval.
        APPROVAL_EXIT,
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
      // In an interactive run (R44) she may ask, and her answer waits for
      // approval when Build visual follows.
      exits: [...MODEL_EXITS, ASKS_EXIT, APPROVAL_EXIT],
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
      // In an interactive run (R44) his visual waits for approval; a
      // change, with reference images or not, makes a new version of it.
      exits: [{ label: 'you stop it', outcome: 'stops' }, APPROVAL_EXIT],
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
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const ANSWER_BUSINESS_QUESTION_EDGES: readonly WorkflowEdge[] = [
  // Start → Receive question, or through Read images when the run has images.
  ...readImagesEdges('receive-question'),
  { from: 'receive-question', to: 'load-catalog', kind: 'next' },
  // One line since 2026-11-19: no follow-up branch, and Plan asks in its
  // own step (no Clarify loop).
  { from: 'load-catalog', to: 'plan', kind: 'next' },
  { from: 'plan', to: 'analyse', kind: 'next' },
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
];

/** The most attempts of the analysis loop: the first and one retry. */
export const ANALYSE_MAX_ATTEMPTS = 2;

/**
 * The agent's step budget on a retry of Analyse (agents.md 2.11, 5.11):
 * the retry is shown the earlier attempt's queries and runs only the ones
 * the failed checks need; the first attempt keeps the agent's 15.
 */
export const ANALYSE_RETRY_MAX_STEPS = 8;

/** The run's RequestContext key holding the per-run `AnswerBusinessQuestionRuntime`. */
export const ANSWER_BUSINESS_QUESTION_RUNTIME_KEY =
  'answer-business-question-runtime';

/**
 * The workflow's input: the question, the session's dataset names and,
 * only when the run has any, its reference images' stored paths.
 */
export type AnswerBusinessQuestionInput = z.output<typeof questionInputSchema>;

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

/** What a waiting step (Plan, Analyse, an approval gate) suspends the run with. */
export type ClarifyingQuestion = z.output<typeof clarifyingQuestionSchema>;

/** A clarifying question with the user's answer to it. */
export type AnsweredClarification = z.output<
  typeof answeredClarificationSchema
>;

/** The Wrap up step's summary: the run's result. */
export type AnswerBusinessQuestionSummary = z.output<typeof turnSummarySchema>;

/** What Build visual made: the run's visual, or why there is none. */
export type BuiltVisual = z.output<typeof builtVisualSchema>;

/**
 * What one analysis attempt of the agent turn gives back; `clarification`
 * when the agent asked the user a clarifying question (`ask_clarification`):
 * the Analyse step then waits for the answer (api.md 138). `retryError`
 * when a retry ended on a model error (not a Stop): the records it made are
 * kept, and Validate keeps the earlier attempt (agents.md 5.11).
 */
export type AnalyseAttempt = Pick<
  AnalyseOutcome,
  'calls' | 'queries' | 'text' | 'stopped'
> & { clarification?: ClarifyingQuestion; retryError?: string };

/**
 * What the session code (or the eval runner) hands the run, on its
 * RequestContext: the model steps call back into it, so the chat sees the
 * turn as today (agents.md 5.11).
 */
export interface AnswerBusinessQuestionRuntime {
  /**
   * A run of the workflow (workflows R44; answer-business-question.review.ts):
   * every step agent may ask the user first, and each outcome that goes on
   * to another agent waits for the user's approval. Absent in a past chat's
   * turn and in an eval run: nothing waits but Plan's and Analyse's own
   * question, as before.
   */
  interactive?: boolean;
  /**
   * The Plan step's model call; `stopped` when the turn was stopped. After
   * Plan asked the user, `clarification` holds its question and the answer.
   */
  plan(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    clarification?: AnsweredClarification;
    /** The changes the user asked for on Plan's approval gate. */
    revision?: Revision;
    /** Read images' notes (agents.md 2.15); absent or `''` without images. */
    imageNotes?: string;
    /**
     * An orchestrator's request (Avery, agents.md 2.21): it ends the plan
     * request. Absent in Answer a Business Question.
     */
    brief?: string;
  }): Promise<{ plan: AnalysisPlan; stopped: boolean }>;
  /**
   * One attempt of the Analyse step: the agent turn with its tools. When
   * the step resumes after the agent's clarifying question, `answered`
   * holds it with the user's answer: the agent goes on from there. On a
   * retry, `earlierBlock` lists the earlier attempt's queries; a retry runs
   * with `ANALYSE_RETRY_MAX_STEPS`, and a model error on it comes back as
   * `retryError` instead of failing the step.
   */
  analyse(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    plan: AnalysisPlan;
    attempt: number;
    planBlock: string;
    /** On a retry: the earlier attempt's queries (`earlierQueriesBlock`). */
    earlierBlock?: string;
    /**
     * On a retry: the earlier attempt's queries and findings the block was
     * built from, so an attempt resumed after the agent's question rebuilds
     * one block with its own queries after them.
     */
    earlier?: Pick<CheckedAttempt, 'queries' | 'findings'>;
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
  /**
   * A change the user asked for on Build visual's approval gate (workflows
   * R44): Ryan makes a new version of the visual from the user's words and,
   * when they attached some, Zoe's notes on the new reference images (their
   * paths in the run's workspace). It never fails the run: a change that
   * fails comes back as `error`.
   */
  reviseVisual?(input: {
    visualId: string;
    instruction: string;
    images?: string[];
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
    /** An interactive run: Jessica may ask the user one question first. */
    canAsk?: boolean;
    /** Her question with the user's answer, once answered. */
    answered?: { question: string; answer: string };
    /** The changes the user asked for on her approval gate. */
    revision?: Revision;
    /**
     * Her answer waits on an approval gate: it is not streamed as the
     * run's answer; `deliverAnswer` hands it over once approved.
     */
    quiet?: boolean;
    /**
     * An orchestrator's request (Avery, agents.md 2.21): it ends the
     * answer request. Absent in Answer a Business Question.
     */
    brief?: string;
  }): Promise<{
    answer: BusinessAnswer;
    stopped: boolean;
    clarification?: { question: string; options: string[] };
  }>;
  /**
   * The run's answer, written outside the stream: Jessica's, once approved
   * on her gate (workflows R44).
   */
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
  // Where each dataset's data ends (*Data dates*, agents.md 5.11).
  const ends = new Map(
    snapshots.map((dataset) => [
      dataset.name,
      dataEnd(
        dataset.tables.map((key) => ({
          key,
          columns: dataset.entities?.find((e) => e.key === key)?.columns ?? [],
        })),
      )?.date ?? null,
    ]),
  );
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
        // The dataset's own end, the same for each of its entities.
        dataEndsAt: ends.get(dataset.name) ?? null,
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
  options: CatalogBlockOptions = {},
): string {
  const lines = columns.map((entry) => {
    const listed = entry.columns
      .map((column) => `${column.name}${column.type ? ` ${column.type}` : ''}`)
      .join(', ');
    const more = entry.more ? ` (+${entry.more} more not listed)` : '';
    return `- ${entry.entity}: ${listed || '(none listed)'}${more}`;
  });
  return [
    catalogBlock(catalog, options),
    ...(lines.length
      ? ['', 'Columns of each entity (name type):', ...lines]
      : ['', 'No columns are known for these entities.']),
  ].join('\n');
}

/** What the catalog block reads besides the catalog. */
export interface CatalogBlockOptions {
  /** The run's question: its time cue adds the data-dates line. */
  question?: string;
  /** Today (tests pass a fixed date). */
  now?: Date;
}

/**
 * The catalog as the Plan and Analyse steps' system message (agents.md
 * 5.11). When the question asks for a figure that depends on the current
 * date or recency (`asksTimeRelative`) and a dataset's data ends well
 * before today (*Data dates*), one last line per such dataset says where it
 * ends and what to measure from; any other request is as before.
 */
export function catalogBlock(
  catalog: readonly CatalogEntity[],
  options: CatalogBlockOptions = {},
): string {
  if (!catalog.length) return 'Catalog loaded for this turn: no entities.';
  const now = options.now ?? new Date();
  const ended = new Map<string, string>();
  if (options.question && asksTimeRelative(options.question)) {
    for (const e of catalog) {
      if (e.dataEndsAt && isSnapshot(e.dataEndsAt, now)) {
        ended.set(e.dataset, e.dataEndsAt);
      }
    }
  }
  return [
    `Catalog loaded for this turn: ${catalog.length} ${catalog.length === 1 ? 'entity' : 'entities'}.`,
    ...catalog.map(
      (e) =>
        `- ${e.entity} (dataset: ${e.dataset}; ${e.columnCount ?? '?'} columns)`,
    ),
    ...[...ended].map(([dataset, date]) => snapshotCatalogLine(dataset, date)),
  ].join('\n');
}

/** The catalog's line for a dataset whose data ends well before today. */
export function snapshotCatalogLine(dataset: string, date: string): string {
  return `The ${dataset} data ends ${date}: a figure that depends on the current date (tenure, age, time since) is measured from that date, not from today, unless the question asks about today.`;
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

/**
 * The check names Validate reports, in order; `retry` only after a retry
 * that ended on a model error (a warning: it never fails the attempt).
 */
export const VALIDATION_CHECKS = {
  ranQuery: 'Ran a query',
  noToolError: 'No unresolved tool error',
  rowLimit: 'No result cut at its row limit',
  sample: 'No answer from a sample',
  measures: 'Measures covered (warning only)',
  dataDate: "Measured from the data's date",
  retry: 'Retry completed (warning only)',
} as const;

/** Whether a check is a warning only: it never fails the attempt. */
function isWarningCheck(check: string): boolean {
  return /\(warning only\)/i.test(check);
}

/** Whether a query kept an arbitrary sample (`coverageOf`, plan 1.25.7). */
function isSampleQuery(query: AnalyseQuery): boolean {
  return (
    coverageOf({
      tool: 'run_readonly_sql',
      sql: query.sql,
      rowCount: query.rowCount,
      truncated: query.truncated,
    }) === 'sample'
  );
}

/** Each query cut at its row limit that no later successful query re-read. */
function unresolvedCuts(queries: readonly AnalyseQuery[]): boolean[] {
  return queries.map(
    (query, index) =>
      !query.error &&
      query.truncated &&
      !queries
        .slice(index + 1)
        .some((later) => !later.error && !later.truncated),
  );
}

/** Each sample that no later successful query read the whole data after. */
function unresolvedSamples(queries: readonly AnalyseQuery[]): boolean[] {
  return queries.map(
    (query, index) =>
      !query.error &&
      isSampleQuery(query) &&
      !queries
        .slice(index + 1)
        .some((later) => !later.error && !isSampleQuery(later)),
  );
}

/**
 * Each successful query that measured against today on a table whose data
 * ends well before it (*Data dates*), and that no later successful query on
 * that table re-read without today.
 */
function unresolvedNow(
  queries: readonly AnalyseQuery[],
  snapshots: readonly string[],
): boolean[] {
  const tablesOf = (sql: string) =>
    snapshots.filter((key) => sqlReadsTable(sql, key));
  return queries.map((query, index) => {
    if (query.error || !readsNow(query.sql)) return false;
    const tables = tablesOf(query.sql);
    if (!tables.length) return false;
    return !queries
      .slice(index + 1)
      .some(
        (later) =>
          !later.error &&
          !readsNow(later.sql) &&
          tablesOf(later.sql).some((key) => tables.includes(key)),
      );
  });
}

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
 * attempt. When the catalog has a table whose data ends well before today
 * (*Data dates*), one more check fails an attempt that measured against
 * today on it (`CURRENT_DATE`, `NOW()`, …) unless the question asks about
 * today; without such a table the findings are as before.
 */
export function validateAttempt(
  input: {
    plan: AnalysisPlan;
    calls: readonly AnalyseCall[];
    queries: readonly AnalyseQuery[];
    catalog?: readonly CatalogEntity[];
    question?: string;
  },
  now: Date = new Date(),
): { ok: boolean; findings: ValidationFinding[] } {
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
  const cuts = unresolvedCuts(queries);
  const cut = queries.filter((_query, index) => cuts[index]);
  const rowLimit: ValidationFinding = {
    check: VALIDATION_CHECKS.rowLimit,
    passed: cut.length === 0,
    detail: cut.length
      ? `${cut.length} ${cut.length === 1 ? 'result was' : 'results were'} cut at the row limit and not aggregated again.`
      : 'No result the answer reads was cut.',
  };
  const samples = unresolvedSamples(queries);
  const sampled = queries.filter((_query, index) => samples[index]);
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
  const dataDate = dataDateFinding(input, now);
  return {
    ok:
      ranQuery.passed &&
      noToolError.passed &&
      rowLimit.passed &&
      sample.passed &&
      (dataDate?.passed ?? true),
    findings: [
      ranQuery,
      noToolError,
      rowLimit,
      sample,
      measures,
      ...(dataDate ? [dataDate] : []),
    ],
  };
}

/**
 * The *Measured from the data's date* check, or undefined when no table of
 * the catalog ends well before today (the findings are then as before).
 */
function dataDateFinding(
  input: {
    queries: readonly AnalyseQuery[];
    catalog?: readonly CatalogEntity[];
    question?: string;
  },
  now: Date,
): ValidationFinding | undefined {
  const snapshots = (input.catalog ?? []).filter((e) =>
    isSnapshot(e.dataEndsAt, now),
  );
  if (!snapshots.length) return undefined;
  const check = VALIDATION_CHECKS.dataDate;
  if (asksAboutToday(input.question ?? '')) {
    return { check, passed: true, detail: 'The question asks about today.' };
  }
  const flags = unresolvedNow(
    input.queries,
    snapshots.map((e) => e.entity),
  );
  const flagged = input.queries.filter((_query, index) => flags[index]);
  if (!flagged.length) {
    return {
      check,
      passed: true,
      detail: 'No query measured against today on data that ends before it.',
    };
  }
  const ends = [
    ...new Map(
      snapshots
        .filter((e) => flagged.some((q) => sqlReadsTable(q.sql, e.entity)))
        .map((e) => [e.dataset, `the ${e.dataset} data ends ${e.dataEndsAt}`]),
    ).values(),
  ].join('; ');
  return {
    check,
    passed: false,
    detail: `${flagged.length} ${flagged.length === 1 ? 'query measured' : 'queries measured'} against today on data that ends well before it (${ends}): measure from the date the data ends, and say which date you used.`,
  };
}

/**
 * The failed check that flagged each query of an attempt (agents.md 5.11),
 * by Validate's own rules, or undefined: a failed query no later query
 * replaced (`Ran a query` or `No unresolved tool error` failed), a result
 * cut at its row limit (`No result cut at its row limit` failed), an
 * arbitrary sample (`No answer from a sample` failed). A query whose check
 * passed is never flagged.
 */
export function flaggedQueries(
  queries: readonly AnalyseQuery[],
  findings: readonly ValidationFinding[],
): (string | undefined)[] {
  const failed = new Set(
    findings
      .filter((f) => !f.passed && !isWarningCheck(f.check))
      .map((f) => f.check),
  );
  const errorCheck = [
    VALIDATION_CHECKS.ranQuery,
    VALIDATION_CHECKS.noToolError,
  ].find((check) => failed.has(check));
  const cuts = unresolvedCuts(queries);
  const samples = unresolvedSamples(queries);
  return queries.map((query, index) => {
    if (
      query.error &&
      errorCheck &&
      !queries.slice(index + 1).some((later) => !later.error)
    ) {
      return errorCheck;
    }
    if (cuts[index] && failed.has(VALIDATION_CHECKS.rowLimit)) {
      return VALIDATION_CHECKS.rowLimit;
    }
    if (samples[index] && failed.has(VALIDATION_CHECKS.sample)) {
      return VALIDATION_CHECKS.sample;
    }
    // Measured against today on a snapshot: the check names no table, so
    // any successful query that read the current date carries it.
    if (
      failed.has(VALIDATION_CHECKS.dataDate) &&
      !query.error &&
      readsNow(query.sql)
    ) {
      return VALIDATION_CHECKS.dataDate;
    }
    return undefined;
  });
}

/** One analysis attempt's calls, queries and Validate's findings. */
export interface CheckedAttempt {
  calls: readonly AnalyseCall[];
  queries: readonly AnalyseQuery[];
  findings: readonly ValidationFinding[];
}

/** What Validate keeps after a retry (agents.md 5.11): the set Write answer reads. */
export interface MergedAttempts {
  ok: boolean;
  findings: ValidationFinding[];
  calls: AnalyseCall[];
  queries: AnalyseQuery[];
  kept: 'merged' | 'first';
}

/**
 * Validate on a retry (agents.md 5.11; workflows R27): the merged set is
 * attempt 2's queries first, then attempt 1's that ran and that no failed
 * check flagged (`flaggedQueries`), so Write answer's cut drops attempt 1's
 * first; the calls follow (attempt 2's, then the kept queries' SQL calls:
 * a data record's call and its query come in the same order). The merged
 * set is checked in the order it ran (attempt 1's kept queries, then
 * attempt 2's), so a query attempt 1 ran never resolves a sample, a cut or
 * a failed call attempt 2 left. Attempt 1
 * alone is kept (`first`) when attempt 2 ended on a model error (with the
 * warning-only `Retry completed` check), ran nothing successfully, or the
 * merged set fails a check attempt 1 passed: a retry never scores below
 * attempt 1.
 */
export function mergeAttempts(input: {
  plan: AnalysisPlan;
  first: CheckedAttempt;
  second: Pick<CheckedAttempt, 'calls' | 'queries'> & { retryError?: string };
  /** The run's catalog and question, for the data-date check (*Data dates*). */
  catalog?: readonly CatalogEntity[];
  question?: string;
}): MergedAttempts {
  const { plan, first, second } = input;
  const keepFirst = (extra: ValidationFinding[] = []): MergedAttempts => ({
    ok: first.findings.every((f) => f.passed || isWarningCheck(f.check)),
    findings: [...first.findings, ...extra],
    calls: [...first.calls],
    queries: [...first.queries],
    kept: 'first',
  });
  if (second.retryError !== undefined) {
    return keepFirst([
      {
        check: VALIDATION_CHECKS.retry,
        passed: false,
        detail: `Attempt 2 stopped on an error (${second.retryError}); the answer rests on attempt 1's queries.`,
      },
    ]);
  }
  if (!second.queries.some((query) => !query.error)) return keepFirst();
  const flagged = flaggedQueries(first.queries, first.findings);
  const keeps = first.queries.map(
    (query, index) => !query.error && flagged[index] === undefined,
  );
  let sqlIndex = 0;
  const firstCalls = first.calls.filter((call) =>
    call.tool === 'run_readonly_sql' ? keeps[sqlIndex++] === true : false,
  );
  const calls = [...second.calls, ...firstCalls];
  const queries = [
    ...second.queries,
    ...first.queries.filter((_query, index) => keeps[index]),
  ];
  // Validate's "resolved by a later query" rules read the order the queries
  // ran: attempt 1's kept ones, then attempt 2's. The display order above
  // is for Write answer only, so an earlier query never resolves a later one.
  const checked = validateAttempt({
    plan,
    catalog: input.catalog,
    question: input.question,
    calls: [...firstCalls, ...second.calls],
    queries: [
      ...first.queries.filter((_query, index) => keeps[index]),
      ...second.queries,
    ],
  });
  const worse = first.findings.some(
    (before) =>
      before.passed &&
      !isWarningCheck(before.check) &&
      checked.findings.some(
        (after) => after.check === before.check && !after.passed,
      ),
  );
  if (worse) return keepFirst();
  return { ...checked, calls, queries, kept: 'merged' };
}

/** Where one kept query ran: its attempt (1 or 2) and its place among that attempt's queries. */
export interface KeptQueryOrigin {
  attempt: 1 | 2;
  index: number;
}

/**
 * Where each query of the set Validate kept after a retry ran (agents.md
 * 5.11; workflows R41), so Build visual is given the records the answer
 * rests on: `attempts` are attempt 1's and attempt 2's queries, each in the
 * order it ran. The kept set is one `mergeAttempts` makes: attempt 2's
 * queries, then some of attempt 1's in order (`merged`), or attempt 1's
 * alone (`first`). A query is matched on everything it carries (its SQL,
 * rationale, rows, row count, cut and error), so two runs of the same SQL
 * that returned different rows are told apart; runs equal in all of that
 * are interchangeable. Undefined without a retry, or when the set is
 * neither shape.
 */
export function keptQueryOrigins(
  attempts: readonly (readonly AnalyseQuery[])[],
  kept: readonly AnalyseQuery[],
): KeptQueryOrigin[] | undefined {
  if (attempts.length !== 2) return undefined;
  const [first, second] = attempts.map((queries) => queries.map(queryKey));
  const keys = kept.map(queryKey);
  // Attempt 2's queries, all of them first, then attempt 1's in order.
  if (second.every((key, index) => keys[index] === key)) {
    const origins: KeptQueryOrigin[] = second.map((_key, index) => ({
      attempt: 2,
      index,
    }));
    let from = 0;
    for (const key of keys.slice(second.length)) {
      const index = first.indexOf(key, from);
      if (index < 0) break;
      origins.push({ attempt: 1, index });
      from = index + 1;
    }
    if (origins.length === keys.length) return origins;
  }
  // Attempt 1's alone.
  if (
    keys.length === first.length &&
    first.every((key, index) => keys[index] === key)
  ) {
    return first.map((_key, index) => ({ attempt: 1, index }));
  }
  return undefined;
}

/** A query as one string of everything it carries (`keptQueryOrigins`). */
function queryKey(query: AnalyseQuery): string {
  return JSON.stringify([
    query.sql,
    query.rationale ?? '',
    query.rowCount,
    query.truncated,
    query.error ?? '',
    query.rows,
  ]);
}

/**
 * The plan after the user answered its question (agents.md 5.11): Plan never
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
  // An approval gate's outcome in words (workflows R44) is shown with it,
  // and Build visual's names the visual it waits on.
  const gate = raw['kind'] === 'review';
  const review = gate ? text(raw['review']) : '';
  const visualId = gate ? text(raw['visualId']) : '';
  return {
    question,
    options: strings(raw['options']),
    ...(review ? { review } : {}),
    ...(visualId ? { visualId } : {}),
  };
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

/**
 * Wrap up: the kept queries' `run_readonly_sql` calls (the last attempt's,
 * or after a retry the merged set's or attempt 1's), their rows, the answer.
 */
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

/** The run's summary (Wrap up's), when the run got that far. */
export function turnSummaryOf(
  result: unknown,
): AnswerBusinessQuestionSummary | undefined {
  const parsed = answerBusinessQuestionResultSchema.safeParse(result);
  if (!parsed.success) return undefined;
  return parsed.data['question-path']?.['analysis-path']?.['answer-path'];
}
