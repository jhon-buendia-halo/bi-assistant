import { askHostOf, askRefusal } from './ask-agent-context';
import {
  ASK_NO_IMAGES_REPLY,
  imageNotesAnswer,
  planAnswer,
} from '../../mastra/workflows/ask-agent.steps';
import { renderImageNotes } from '../../mastra/workflows/read-images.steps';
import type { WorkflowRunDoc } from './workflow-run-steps';

const PLAN = {
  question: 'How many matches per year?',
  measures: ['matches'],
  entities: ['wc.public.matches'],
  scope: 'all years',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

function earlierRun(overrides: Partial<WorkflowRunDoc> = {}): WorkflowRunDoc {
  return {
    id: 'run-1',
    workflowId: 'answer-business-question',
    workflowName: 'Answer a Business Question',
    input: { question: 'How many matches per year?' },
    status: 'success',
    question: 'How many matches per year?',
    steps: [
      { id: 'read-images', title: 'Read images', status: 'skipped' },
      {
        id: 'interpret-follow-up',
        title: 'Interpret follow-up',
        status: 'success',
      },
      {
        id: 'plan',
        title: 'Plan',
        status: 'success',
        output: { plan: PLAN },
      },
      { id: 'analyse', title: 'Analyse', status: 'success', attempt: 1 },
      {
        id: 'check-data-quality',
        title: 'Check data quality',
        status: 'success',
        output: {
          findings: [
            { check: 'Ran a query', passed: true, detail: 'ok' },
            {
              check: 'Data quality: wc.public.matches.year (validity, high)',
              passed: false,
              detail: 'Some years are null.',
            },
            { check: 'broken' },
          ],
        },
      },
      { id: 'write-answer', title: 'Write answer', status: 'success' },
    ],
    datasets: ['World Cup'],
    answer: {
      role: 'assistant',
      content: 'There were 64 matches in 2022.',
      at: '2026-11-17T00:00:00.000Z',
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT year, COUNT(*) FROM wc.public.matches GROUP BY year',
          rows: [{ year: 2022, count: 64 }],
          rowCount: 1,
        },
      ],
      evidence: [{ index: 0, coverage: 'whole', datasourceId: 'ds-pg' }],
    },
    startedAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  } as WorkflowRunDoc;
}

describe('askRefusal (api.md 118; workflows R38)', () => {
  it('lets a step that ran in a run of Answer a Business Question be asked', () => {
    expect(
      askRefusal('answer-business-question', 'write-answer', earlierRun()),
    ).toBeNull();
  });

  it('refuses another workflow', () => {
    expect(
      askRefusal('data-readiness-assessment', 'write-answer', earlierRun()),
    ).toBe(`Workflow "data-readiness-assessment" can't ask one agent`);
  });

  it('refuses a code step and an unknown step', () => {
    expect(
      askRefusal('answer-business-question', 'validate', earlierRun()),
    ).toBe('Step "validate" has no agent to ask');
    expect(askRefusal('answer-business-question', 7, earlierRun())).toBe(
      'Step "7" has no agent to ask',
    );
  });

  it('refuses a step the earlier run skipped or never reached', () => {
    expect(
      askRefusal('answer-business-question', 'read-images', earlierRun()),
    ).toBe('Step "read-images" did not run in run "run-1"');
    const short = earlierRun({
      steps: earlierRun().steps.filter((step) => step.id !== 'plan'),
    });
    expect(askRefusal('answer-business-question', 'plan', short)).toBe(
      'Step "plan" did not run in run "run-1"',
    );
  });
});

describe('askHostOf (agents.md 5.21)', () => {
  it('asks the Analyst from copies of the run threads, with the step context block', () => {
    const host = askHostOf(earlierRun(), 'analyse');
    expect(host.ask).toEqual({ step: 'analyse' });
    expect(host.agentKey).toBeUndefined();
    expect(host.continuesThreads).toBe(true);
    expect(host.contextBlock).toContain('step "Analyse" (analyse)');
  });

  it("binds Sarah to the host, without the Analyst's thread", () => {
    const host = askHostOf(earlierRun(), 'check-data-quality');
    expect(host.agentKey).toBe('data-readiness');
    expect(host.continuesThreads).toBe(false);
    expect(host.contextBlock).toContain('Check data quality');
  });

  it("gives Jessica the earlier answer's records, plan, quality findings and notes", () => {
    const host = askHostOf(earlierRun(), 'write-answer');
    expect(host.ask.earlier).toEqual({
      plan: PLAN,
      qualityFindings: [
        {
          check: 'Data quality: wc.public.matches.year (validity, high)',
          passed: false,
          detail: 'Some years are null.',
        },
      ],
      imageNotes: '',
      records: earlierRun().answer!.data,
      evidence: earlierRun().answer!.evidence,
    });
    expect(host.contextBlock).toBeUndefined();
  });

  it('gives Jessica no plan when the earlier run did not keep it', () => {
    const run = earlierRun();
    const plan = run.steps.find((step) => step.id === 'plan')!;
    delete plan.output;
    plan.outputTruncated = true;
    expect(askHostOf(run, 'write-answer').ask.earlier?.plan).toBeNull();
  });

  it('asks Olivia, Nathan and Zoe as the step alone', () => {
    for (const step of [
      'plan',
      'interpret-follow-up',
      'read-images',
    ] as const) {
      expect(askHostOf(earlierRun(), step)).toEqual({
        ask: { step },
        continuesThreads: true,
      });
    }
  });
});

describe('planAnswer (agents.md 5.21)', () => {
  it("gives Olivia's clarifying question with its options when she needs one", () => {
    const answer = planAnswer({
      ...PLAN,
      needsClarification: true,
      clarification: {
        question: 'Which matches count?',
        options: ['Every match', 'Finals only'],
      },
    });
    expect(answer).toBe(
      [
        'Which matches count?',
        '',
        '- Every match',
        '- Finals only',
        '',
        'Answer with one of these and ask the whole workflow to run it.',
      ].join('\n'),
    );
  });
});

describe('imageNotesAnswer (agents.md 5.21)', () => {
  it("gives Zoe's notes without the lines meant for a model", () => {
    const imageNotes = renderImageNotes([
      {
        index: 1,
        kind: 'chart',
        title: 'Goals per year',
        shows: 'A bar chart of goals per World Cup.',
        figures: ['2022: 24'],
        text: '',
      },
    ]);
    expect(
      imageNotesAnswer({ imageNotes, imageCount: 1, stopped: false }),
    ).toBe(
      [
        '### Image 1: Goals per year (chart)',
        'What it shows: A bar chart of goals per World Cup.',
        'Figures and labels:',
        '- 2022: 24',
      ].join('\n'),
    );
  });

  it('says so when there are no notes', () => {
    expect(
      imageNotesAnswer({ imageNotes: '', imageCount: 0, stopped: false }),
    ).toBe(ASK_NO_IMAGES_REPLY);
  });
});
