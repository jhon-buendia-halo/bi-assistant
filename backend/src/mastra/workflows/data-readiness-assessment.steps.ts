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
  profiledSourceSchema,
  scoredSourceSchema,
} from './data-readiness-assessment.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowStepExit,
} from './answer-business-question.steps';
import type { WorkflowEdge } from './workflow-contract';

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
  { label: 'Datasource unreachable', outcome: 'fails' },
  { label: 'Stop', outcome: 'stops' },
];

/**
 * The steps, in catalogue order. Their field names and JSON Schemas come
 * from ./data-readiness-assessment.schemas.ts; how they connect is
 * `DATA_READINESS_ASSESSMENT_EDGES`.
 */
export const DATA_READINESS_ASSESSMENT_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'resolve-dataset',
      title: 'Resolve dataset',
      kind: 'code',
      summary:
        "Finds the dataset's PostgreSQL or Databricks datasource and its tables, the assessment's scope. No LLM.",
      exits: [
        { label: 'Not a PostgreSQL or Databricks dataset', outcome: 'fails' },
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
      id: 'save-report',
      title: 'Save report',
      kind: 'code',
      summary:
        "Stores the report with the run's id and shows its readiness card. No LLM.",
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
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
      ],
    },
    SCHEMAS['explain-report'],
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
  { from: 'score-readiness', to: 'save-report', kind: 'next' },
  { from: 'save-report', to: 'explain-report', kind: 'next' },
  { from: 'explain-report', to: 'wrap-up', kind: 'next' },
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
  /** Save report: stores it and shows its readiness card. */
  save(): Promise<{ reportId: string }>;
  /** Explain report: the agent's turn over the stored report. */
  explain(input: {
    question: string;
    dataset: string;
    reportId: string;
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
 * assessment has already run, so the agent reads the stored report (its
 * one tool there) and answers from it (data-readiness R4).
 */
export function explainReportBlock(input: {
  reportId: string;
  dataset: string;
}): string {
  return [
    `The workflow has already assessed the dataset "${input.dataset}" and stored readiness report ${input.reportId}.`,
    `Call get_readiness_report with reportId "${input.reportId}" first, then answer the user's question from that report only.`,
    'Do not run another assessment.',
  ].join('\n');
}
