import {
  DEEP_ANALYSIS_STEPS,
  DEEP_ANALYSIS_WORKFLOW_ID,
  FINDINGS_CHARS_CAP,
  angleFinding,
  assembleReport,
  extractSqlBlocks,
  failedAngle,
  findingsBlock,
  receivePlan,
  reportMarkdown,
  reportTitle,
  runReportPath,
} from './deep-analysis.steps';

const ANGLES = [
  { title: 'By payer', question: 'Which payers deny most?' },
  { title: 'By month', question: 'How did denials trend?' },
  { title: 'By reason', question: 'Which reasons dominate?' },
];

describe('deep-analysis steps (agents.md 5.15; plan 1.25.3)', () => {
  it('runs Plan, Investigate, Write, then Assemble: three agent steps and one code step', () => {
    expect(DEEP_ANALYSIS_WORKFLOW_ID).toBe('deep-analysis');
    expect(
      DEEP_ANALYSIS_STEPS.map((step) => [step.id, step.title, step.kind]),
    ).toEqual([
      ['plan', 'Plan', 'agent'],
      ['investigate', 'Investigate', 'agent'],
      ['write', 'Write', 'agent'],
      ['assemble', 'Assemble', 'code'],
    ]);
  });

  it('chains each step on the fields the one before it returns', () => {
    for (let i = 1; i < DEEP_ANALYSIS_STEPS.length; i++) {
      expect(DEEP_ANALYSIS_STEPS[i].input).toEqual(
        DEEP_ANALYSIS_STEPS[i - 1].output,
      );
    }
    expect(DEEP_ANALYSIS_STEPS[0].input).toEqual(['question', 'datasets']);
  });

  it('keeps the same three assistant calls: tool-free plan and write, a 15-step investigation', () => {
    expect(
      DEEP_ANALYSIS_STEPS.map((step) =>
        'agentCall' in step ? step.agentCall : undefined,
      ),
    ).toEqual([
      { tools: false, maxSteps: 1 },
      { tools: true, maxSteps: 15 },
      { tools: false, maxSteps: 1 },
      undefined,
    ]);
  });
});

describe('Plan (R5)', () => {
  it('keeps at most five angles', () => {
    const angles = Array.from({ length: 7 }, (_, i) => ({
      title: `A${i}`,
      question: `q${i}`,
    }));
    expect(receivePlan({ title: 'T', angles }, 'Q').angles).toHaveLength(5);
  });

  it('takes the first 80 characters of the question for a blank title', () => {
    const question = 'x'.repeat(100);
    expect(receivePlan({ title: '  ', angles: ANGLES }, question).title).toBe(
      'x'.repeat(80),
    );
    expect(receivePlan({ title: ' Denials ', angles: ANGLES }, 'Q').title).toBe(
      'Denials',
    );
  });

  it('fails without angles', () => {
    expect(() => receivePlan({ title: 'T', angles: [] }, 'Q')).toThrow(
      'the planner returned no angles',
    );
  });
});

describe('Investigate (R7, R8)', () => {
  it('caps the findings and lists each distinct SQL statement', () => {
    const text = `${'a'.repeat(FINDINGS_CHARS_CAP + 10)}\n\`\`\`sql\nselect 1\n\`\`\``;
    const finding = angleFinding(ANGLES[0], text);
    expect(finding.findings).toHaveLength(FINDINGS_CHARS_CAP);
    expect(
      angleFinding(ANGLES[0], 'x ```sql\nselect 1\n``` ```sql\nselect 1\n```')
        .sql,
    ).toEqual(['select 1']);
    expect(angleFinding(ANGLES[0], '  ').findings).toBe(
      'No findings returned.',
    );
  });

  it('notes an angle that failed, with no SQL', () => {
    expect(failedAngle(ANGLES[1], 'timeout')).toEqual({
      ...ANGLES[1],
      findings: 'This angle could not be investigated — timeout',
      sql: [],
    });
  });

  it('writes the findings block the report phase receives', () => {
    expect(
      findingsBlock([
        { ...ANGLES[0], findings: 'f1', sql: [] },
        { ...ANGLES[1], findings: 'f2', sql: [] },
      ]),
    ).toBe(
      '### Angle 1: By payer\nWhich payers deny most?\n\nf1\n\n### Angle 2: By month\nHow did denials trend?\n\nf2',
    );
  });
});

describe('Write and Assemble (R9, R11, R12, R19)', () => {
  it("takes the writer's title unless it is blank", () => {
    const written = { title: ' ', executiveSummary: 'S', report: 'B' };
    expect(reportTitle(written, 'Planned')).toBe('Planned');
    expect(reportTitle({ ...written, title: 'Written' }, 'Planned')).toBe(
      'Written',
    );
  });

  it('stores the report under reports/, named after its title', () => {
    expect(runReportPath('Denial drivers: 2025!', 'abcdef123456')).toBe(
      'reports/denial-drivers-2025.md',
    );
    expect(runReportPath('***', 'abcdef123456')).toBe(
      'reports/deep-analysis-abcdef12.md',
    );
  });

  it('assembles the report around the written body, with the appendix from the findings', () => {
    const { markdown, report } = assembleReport({
      question: 'Why are denials rising?',
      title: 'Denial drivers',
      executiveSummary: '  Denials rose to 12.4%.  ',
      body: '## Findings by angle\n\nPayer A.\n\n## Anomalies and drivers\n\n## Recommendations\n',
      findings: [
        { ...ANGLES[0], findings: 'f', sql: ['select 1'] },
        { ...ANGLES[1], findings: 'f', sql: [] },
      ],
      reportId: 'run-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(report).toEqual({
      title: 'Denial drivers',
      executiveSummary: 'Denials rose to 12.4%.',
      path: 'reports/denial-drivers.md',
      angles: 2,
    });
    expect(markdown.split('\n').slice(0, 9)).toEqual([
      '# Denial drivers',
      '',
      '**Question:** Why are denials rising?',
      '',
      'Deep analysis · 2 angles · generated 2026-01-01T00:00:00.000Z',
      '',
      '## Executive summary',
      '',
      'Denials rose to 12.4%.',
    ]);
    const order = [
      '## Executive summary',
      '## Findings by angle',
      '## Anomalies and drivers',
      '## Recommendations',
      '## Data appendix',
      '### 1. By payer',
      '```sql\nselect 1\n```',
      '### 2. By month',
      '_No SQL was recorded for this angle._',
      'Report run-1',
    ].map((part) => markdown.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names the session when one is given (the chat report)', () => {
    const markdown = reportMarkdown({
      title: 'T',
      question: 'Q',
      executiveSummary: 'S',
      body: 'B',
      findings: [{ title: 'A', question: 'qa', findings: 'f', sql: [] }],
      sessionName: 'P',
      generatedAt: 'now',
      jobId: 'job-1',
    });
    expect(markdown).toContain(
      'Deep analysis · session: P · 1 angle · generated now',
    );
  });

  it('de-duplicates the SQL it collects', () => {
    expect(
      extractSqlBlocks(
        'text ```sql\nselect 1\n``` more ```SQL\nselect 1\n``` ```sql\nselect 2\n```',
      ),
    ).toEqual(['select 1', 'select 2']);
  });
});
