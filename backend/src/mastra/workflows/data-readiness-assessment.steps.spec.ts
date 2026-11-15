import {
  DATA_READINESS_ASSESSMENT_EDGES,
  DATA_READINESS_ASSESSMENT_STEPS,
  READINESS_DEFAULT_QUESTION,
  assessmentQuestion,
  assessmentSummary,
  explainReportBlock,
} from './data-readiness-assessment.steps';

describe('Assess Data Readiness steps (agents.md 5.13)', () => {
  it('lists the steps in run order, with the one agent step', () => {
    expect(
      DATA_READINESS_ASSESSMENT_STEPS.map((step) => [step.id, step.kind]),
    ).toEqual([
      ['resolve-dataset', 'code'],
      ['profile-source', 'code'],
      ['score-readiness', 'code'],
      ['save-report', 'code'],
      ['explain-report', 'agent'],
      ['wrap-up', 'code'],
    ]);
  });

  it('connects them in one line from Start to End', () => {
    const order = [
      'start',
      ...DATA_READINESS_ASSESSMENT_STEPS.map((s) => s.id),
      'end',
    ];
    expect(DATA_READINESS_ASSESSMENT_EDGES).toEqual(
      order.slice(1).map((to, index) => ({
        from: order[index],
        to,
        kind: 'next',
      })),
    );
  });

  it('derives each step input and output field from its schemas', () => {
    const fields = Object.fromEntries(
      DATA_READINESS_ASSESSMENT_STEPS.map((step) => [
        step.id,
        { input: step.input, output: step.output },
      ]),
    );
    expect(fields['resolve-dataset']).toEqual({
      input: ['question', 'dataset'],
      output: [
        'question',
        'dataset',
        'datasourceName',
        'datasourceKind',
        'tableCount',
      ],
    });
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

  it('tells the agent to read the stored report and not assess again', () => {
    const block = explainReportBlock({ reportId: 'r-1', dataset: 'World Cup' });
    expect(block).toContain('stored readiness report r-1');
    expect(block).toContain('Call get_readiness_report with reportId "r-1"');
    expect(block).toContain('Do not run another assessment.');
  });
});
