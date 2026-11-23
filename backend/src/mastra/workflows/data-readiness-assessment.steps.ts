/**
 * The step catalogue of the Assess Data Readiness workflow (agents.md 5.13;
 * data-readiness R2): its id and name, the steps and edges the workflow
 * page shows, the runtime a run hands its steps, and the pure code of its
 * deterministic steps. No framework import, so the catalogue and Jest can
 * read it without loading Mastra; ./data-readiness-assessment.workflow.ts
 * builds the Mastra steps from it.
 */
import type { z } from 'zod';
import { DATA_READINESS_ASSESSMENT_STEP_SCHEMAS } from './data-readiness-assessment.schemas';
import type {
  assessmentSummarySchema,
  assessmentTargetSchema,
  explainedReportSchema,
  findingRowsSchema,
  profiledSourceSchema,
  scoredSourceSchema,
} from './data-readiness-assessment.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
  type WorkflowStepExit,
} from './workflow-contract';
import {
  READ_IMAGES_STEP_ID,
  READ_IMAGES_STEP_TITLE,
} from './read-images.steps';

/** The workflow's registry key and id. */
export const DATA_READINESS_ASSESSMENT_WORKFLOW_ID =
  'data-readiness-assessment';

/** The name the app shows for the workflow (workflows R1). */
export const DATA_READINESS_ASSESSMENT_WORKFLOW_NAME = 'Assess Data Readiness';

/** What the catalogue says the workflow does. */
export const DATA_READINESS_ASSESSMENT_DESCRIPTION =
  'Profiles a PostgreSQL or Databricks dataset, scores it on the DMBOK data-quality dimensions with a deterministic engine, stores the report and has the Data Readiness Agent explain it.';

/** What a run asks when its question is left empty (data-readiness R2). */
export const READINESS_DEFAULT_QUESTION =
  'Assess the readiness of this dataset';

/** The RequestContext key of a run's runtime. */
export const DATA_READINESS_ASSESSMENT_RUNTIME_KEY =
  'data-readiness-assessment-runtime';

const SCHEMAS = DATA_READINESS_ASSESSMENT_STEP_SCHEMAS;

const SOURCE_EXITS: readonly WorkflowStepExit[] = [
  { label: 'the datasource cannot be reached', outcome: 'fails' },
  { label: 'you stop it', outcome: 'stops' },
];

/**
 * The steps, in catalogue order: the order they run in. Their field names
 * and JSON Schemas come from ./data-readiness-assessment.schemas.ts; how
 * they connect is `DATA_READINESS_ASSESSMENT_EDGES`. Zoe reads the images
 * from Resolve dataset on, while the dataset is profiled and scored; Read
 * images waits for her notes before anything is stored. The rows behind
 * findings are looked up from Save report on, while the agent explains
 * the report (agents.md 5.13).
 */
export const DATA_READINESS_ASSESSMENT_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'resolve-dataset',
      title: 'Resolve dataset',
      kind: 'code',
      summary:
        "Finds the dataset's PostgreSQL or Databricks datasource and its tables, the assessment's scope. With reference images, then starts Zoe's reading of them. No LLM.",
      exits: [
        {
          label: 'the dataset is not PostgreSQL or Databricks',
          outcome: 'fails',
        },
      ],
    },
    SCHEMAS['resolve-dataset'],
  ),
  contractStepEntry(
    {
      id: 'profile-source',
      title: 'Profile source',
      kind: 'code',
      summary:
        'Reads aggregate, read-only statistics of every table: counts, nulls, distincts, ranges, keys, formats and orphans. No row values, no LLM.',
      exits: SOURCE_EXITS,
    },
    SCHEMAS['profile-source'],
  ),
  contractStepEntry(
    {
      id: 'score-readiness',
      title: 'Score readiness',
      kind: 'code',
      summary:
        'The deterministic engine runs the checks and scores the eight assessed DMBOK dimensions, the overall score and the maturity band. No LLM.',
      exits: [],
    },
    SCHEMAS['score-readiness'],
  ),
  contractStepEntry(
    {
      id: READ_IMAGES_STEP_ID,
      title: READ_IMAGES_STEP_TITLE,
      kind: 'agent',
      summary:
        'Optional: waits for the notes Zoe, the Image Reader, has been writing on the reference images since Resolve dataset (one model call). Explain report gets them as text, never the images.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
      ],
      modelOnly: true,
    },
    SCHEMAS['read-images'],
  ),
  contractStepEntry(
    {
      id: 'save-report',
      title: 'Save report',
      kind: 'code',
      summary:
        "Stores the report with the run's id and shows its readiness card, then starts looking up the rows behind its findings. No LLM.",
      exits: [],
    },
    SCHEMAS['save-report'],
  ),
  contractStepEntry(
    {
      id: 'explain-report',
      title: 'Explain report',
      kind: 'agent',
      summary:
        "The Data Readiness Agent reads the stored report and answers the run's question from it. It never changes a score.",
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
      ],
    },
    SCHEMAS['explain-report'],
  ),
  contractStepEntry(
    {
      id: 'finding-rows',
      title: 'Rows behind findings',
      kind: 'code',
      summary:
        "A read-only query of the rows behind each of the report's top findings (at most 20), run while the agent explains the report; each is a source of the answer, ahead of the agent's own. A query that fails stays a failed source. No LLM.",
      exits: [{ label: 'you stop it', outcome: 'stops' }],
    },
    SCHEMAS['finding-rows'],
  ),
  contractStepEntry(
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      summary:
        "Returns the report's id, scores and the answer as the run's result.",
      exits: [],
    },
    SCHEMAS['wrap-up'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const DATA_READINESS_ASSESSMENT_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'resolve-dataset', kind: 'next' },
  { from: 'resolve-dataset', to: 'profile-source', kind: 'next' },
  { from: 'profile-source', to: 'score-readiness', kind: 'next' },
  // Read images dominates no step: Save report defaults its notes.
  {
    from: 'score-readiness',
    to: 'save-report',
    kind: 'next',
    label: 'No images',
    note: 'The run has no reference images, so the report is stored straight away.',
  },
  {
    from: 'score-readiness',
    to: READ_IMAGES_STEP_ID,
    kind: 'branch',
    label: 'Reference images',
    note: "The run has images: Zoe's notes, read meanwhile, are awaited first.",
  },
  { from: READ_IMAGES_STEP_ID, to: 'save-report', kind: 'next' },
  { from: 'save-report', to: 'explain-report', kind: 'next' },
  { from: 'explain-report', to: 'finding-rows', kind: 'next' },
  { from: 'finding-rows', to: 'wrap-up', kind: 'next' },
  { from: 'wrap-up', to: 'end', kind: 'next' },
];

export type AssessmentTarget = Omit<
  z.output<typeof assessmentTargetSchema>,
  'question'
>;
export type ProfileOutcome = Pick<
  z.output<typeof profiledSourceSchema>,
  'entityCount' | 'relationshipCount' | 'notProfiledCount' | 'stopped'
>;
export type ScoreOutcome = Pick<
  z.output<typeof scoredSourceSchema>,
  'overallScore' | 'maturity' | 'findingCount' | 'dimensionScores'
>;
export type FindingRowsOutcome = Pick<
  z.output<typeof findingRowsSchema>,
  'sourceCount' | 'failedSourceCount' | 'stopped'
>;
export type ExplainedReport = z.output<typeof explainedReportSchema>;
export type AssessmentSummary = z.output<typeof assessmentSummarySchema>;

/**
 * What a run hands its steps on the RequestContext: one assessment of the
 * run's dataset, phase by phase, and the agent turn that explains it. A
 * step throws when it is missing.
 */
export interface DataReadinessAssessmentRuntime {
  /** Resolve dataset: the dataset's datasource and scope; throws the reason. */
  resolve(input: { dataset: string }): Promise<AssessmentTarget>;
  /** Profile source; `stopped` when the run was stopped meanwhile. */
  profile(): Promise<ProfileOutcome>;
  /** Score readiness: the deterministic engine over the profile. */
  score(): ScoreOutcome;
  /**
   * Resolve dataset, once the dataset is resolved and the run has images:
   * start Zoe's one model call over them (agents.md 2.15), while the
   * dataset is profiled and scored. `question` is the run's own.
   */
  startImageNotes(input: { question: string; images: string[] }): void;
  /** The condition of Read images: whether Zoe's notes were started. */
  readsImages(): boolean;
  /**
   * Read images: the notes started at Resolve dataset; rethrows a model
   * error, so the run fails before Save report stores anything.
   */
  imageNotes(): Promise<{
    imageNotes: string;
    imageCount: number;
    stopped: boolean;
  }>;
  /** Save report: stores it and shows its readiness card. */
  save(): Promise<{ reportId: string }>;
  /**
   * Save report, once stored: start the rows behind findings, which run
   * while the agent explains the report.
   */
  startFindingRows(): void;
  /**
   * Rows behind findings (roadmap 1.28.11): the queries Save report
   * started, one read-only query per top finding of the saved report, each
   * recorded as a source of the answer ahead of the agent's own; a failed
   * query is a failed source, never a failed run. `stopped` when the run
   * was stopped meanwhile.
   */
  findingRows(): Promise<FindingRowsOutcome>;
  /** Explain report: the agent's turn over the stored report. */
  explain(input: {
    question: string;
    dataset: string;
    reportId: string;
    /**
     * Read images' notes (agents.md 2.15): the turn adds them after the
     * report block only when not `''`; absent or `''` without images.
     */
    imageNotes?: string;
  }): Promise<{ answer: string; stopped: boolean }>;
}

/** The question a run asks: its own, else the default (data-readiness R2). */
export function assessmentQuestion(question: string): string {
  return question.trim() || READINESS_DEFAULT_QUESTION;
}

/** Wrap up: the run's result from Explain report's output. */
export function assessmentSummary(input: ExplainedReport): AssessmentSummary {
  return {
    reportId: input.reportId,
    overallScore: input.overallScore,
    maturity: input.maturity,
    findingCount: input.findingCount,
    answer: input.answer,
  };
}

/**
 * The system block the Explain report step adds to the agent's turn: the
 * assessment has already run, so the block carries the stored report's
 * model-facing summary, exactly what `get_readiness_report` returns to the
 * model for it (`readinessModelOutput`, agents.md 3.13), and the agent
 * calls that tool only for a part the summary does not hold: one round trip
 * less a run (data-readiness R4, agents.md 5.13).
 */
export function explainReportBlock(input: {
  reportId: string;
  dataset: string;
  /** The report's summary, as `readinessModelOutput` projects it. */
  summary: unknown;
}): string {
  return [
    `The workflow has already assessed the dataset "${input.dataset}" and stored readiness report ${input.reportId}.`,
    `The summary of report ${input.reportId} is below, as get_readiness_report returns it. Answer the user's question from that report only.`,
    `Call get_readiness_report with reportId "${input.reportId}" only for a part the summary does not hold, such as every finding of one dimension.`,
    'Do not run another assessment.',
    JSON.stringify(input.summary),
  ].join('\n');
}
