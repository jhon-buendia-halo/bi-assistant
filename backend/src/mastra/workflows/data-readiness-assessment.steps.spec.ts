import {
  DATA_READINESS_ASSESSMENT_EDGES,
  DATA_READINESS_ASSESSMENT_STEPS,
  READINESS_DEFAULT_QUESTION,
  assessmentQuestion,
  assessmentSummary,
  explainReportBlock,
} from './data-readiness-assessment.steps';
import type { ReadinessReport } from '../../modules/data-readiness/engine/types';
import { readinessSummary } from '../../modules/sessions/readiness-bridge';
import {
  getReadinessReportTool,
  readinessModelOutput,
} from '../tools/readiness.tools';

/** A stored report, as Save report stores it (agents.md 3.13). */
const REPORT: ReadinessReport = {
  id: 'r-1',
  datasourceId: 'pg-1',
  datasourceName: 'World Cup PostgreSQL',
  datasourceKind: 'postgres',
  generatedAt: '2026-11-17T10:00:00.000Z',
  runId: 'run-1',
  entityCount: 2,
  overallScore: 84,
  maturity: 'Managed',
  dimensionScores: [
    {
      dimension: 'completeness',
      score: 62.5,
      findingCount: 1,
      maxSeverity: 'high',
      assessed: true,
      totalChecks: 4,
    },
  ],
  findings: [
    {
      dimension: 'completeness',
      level: 'entity',
      namespace: 'public',
      entity: 'matches',
      field: 'referee',
      severity: 'high',
      measured: 0.62,
      description: '62% of referee values are missing.',
      recommendation: 'Make referee required at capture.',
    },
  ],
};

describe('Assess Data Readiness steps (agents.md 5.13)', () => {
  it('lists the steps in run order, with the one agent step', () => {
    expect(
      DATA_READINESS_ASSESSMENT_STEPS.map((step) => [step.id, step.kind]),
    ).toEqual([
      ['resolve-dataset', 'code'],
      ['profile-source', 'code'],
      ['score-readiness', 'code'],
      ['read-images', 'agent'],
      ['save-report', 'code'],
      ['explain-report', 'agent'],
      ['finding-rows', 'code'],
      ['wrap-up', 'code'],
    ]);
  });

  it('connects them from Start to End, with Read images as an optional detour before Save report', () => {
    expect(
      DATA_READINESS_ASSESSMENT_EDGES.map((e) => [e.from, e.to, e.kind]),
    ).toEqual([
      ['start', 'resolve-dataset', 'next'],
      ['resolve-dataset', 'profile-source', 'next'],
      ['profile-source', 'score-readiness', 'next'],
      ['score-readiness', 'save-report', 'next'],
      ['score-readiness', 'read-images', 'branch'],
      ['read-images', 'save-report', 'next'],
      ['save-report', 'explain-report', 'next'],
      ['explain-report', 'finding-rows', 'next'],
      ['finding-rows', 'wrap-up', 'next'],
      ['wrap-up', 'end', 'next'],
    ]);
  });

  it('derives each step input and output field from its schemas', () => {
    const fields = Object.fromEntries(
      DATA_READINESS_ASSESSMENT_STEPS.map((step) => [
        step.id,
        { input: step.input, output: step.output },
      ]),
    );
    expect(fields['resolve-dataset']).toEqual({
      input: ['question', 'dataset', 'images'],
      output: [
        'question',
        'dataset',
        'datasourceName',
        'datasourceKind',
        'tableCount',
      ],
    });
    expect(fields['read-images']).toEqual({
      input: [],
      output: ['imageNotes', 'imageCount', 'stopped'],
    });
    expect(fields['save-report'].input).toEqual(
      expect.arrayContaining(['imageNotes', 'stopped']),
    );
    expect(fields['save-report'].output).toContain('reportId');
    expect(fields['wrap-up'].output).toEqual([
      'reportId',
      'overallScore',
      'maturity',
      'findingCount',
      'answer',
    ]);
  });

  it('asks the default question for a blank one (data-readiness R2)', () => {
    expect(assessmentQuestion('  ')).toBe(READINESS_DEFAULT_QUESTION);
    expect(assessmentQuestion(' Worst problems? ')).toBe('Worst problems?');
  });

  it('wraps up with the report, its scores and the answer, not the stop flag', () => {
    expect(
      assessmentSummary({
        reportId: 'r-1',
        overallScore: 84,
        maturity: 'Managed',
        findingCount: 2,
        answer: 'Managed.',
        stopped: false,
      }),
    ).toEqual({
      reportId: 'r-1',
      overallScore: 84,
      maturity: 'Managed',
      findingCount: 2,
      answer: 'Managed.',
    });
  });

  it('hands the agent the summary get_readiness_report gives the model, and the tool only for the rest (data-readiness R4)', async () => {
    const saved = { report: REPORT, summary: readinessSummary(REPORT) };
    const block = explainReportBlock({
      reportId: 'r-1',
      dataset: 'World Cup',
      summary: readinessModelOutput(saved),
    });
    // What the tool hands the model for the same stored report.
    const toModelOutput = getReadinessReportTool.toModelOutput as (
      output: unknown,
    ) => Promise<{ type: string; value: unknown }> | { value: unknown };
    const { value } = await toModelOutput(saved);
    expect(block).toContain('stored readiness report r-1');
    expect(block).toContain(
      'The summary of report r-1 is below, as get_readiness_report returns it.',
    );
    expect(block).toContain(
      'Call get_readiness_report with reportId "r-1" only for a part the summary does not hold',
    );
    expect(block).not.toContain('first, then answer');
    expect(block).toContain('Do not run another assessment.');
    // The block ends with that projection, and holds no field of the full
    // report the model never sees.
    expect(block.endsWith(`\n${JSON.stringify(value)}`)).toBe(true);
    expect(block).not.toContain('"findings"');
    expect(block).not.toContain('datasourceId');
  });
});
