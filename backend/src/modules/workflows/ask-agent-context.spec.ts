import { askHostOf, askRefusal, chartedRunOf } from './ask-agent-context';
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
      // A run stored before Check data quality left the workflow.
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
      // The run's input did not tick Build a visual.
      { id: 'build-visual', title: 'Build visual', status: 'skipped' },
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

describe('askRefusal (api.md 118; workflows R40)', () => {
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

  it('lets Build visual be asked when the earlier answer has query rows, even if it skipped or charted nothing', () => {
    expect(
      askRefusal('answer-business-question', 'build-visual', earlierRun()),
    ).toBeNull();
    const nothingCharted = earlierRun({
      steps: earlierRun().steps.map((step) =>
        step.id === 'build-visual'
          ? {
              ...step,
              status: 'success' as const,
              output: {
                visual: { skipped: 'No query returned rows to chart.' },
              },
            }
          : step,
      ),
    });
    expect(
      askRefusal('answer-business-question', 'build-visual', nothingCharted),
    ).toBeNull();
  });

  it('refuses Build visual when the earlier answer has no query rows to chart', () => {
    const run = earlierRun();
    const noRows = earlierRun({
      answer: {
        ...run.answer!,
        data: [
          { tool: 'describe_entity', input: 'wc.public.matches', rows: [{}] },
          {
            tool: 'run_readonly_sql',
            input: 'SELECT 1 WHERE false',
            rows: [],
            rowCount: 0,
          },
          {
            tool: 'run_readonly_sql',
            input: 'SELECT broken',
            rows: [{ x: 1 }],
            error: 'syntax error',
          },
        ],
      },
    });
    expect(askRefusal('answer-business-question', 'build-visual', noRows)).toBe(
      'The earlier answer has no query rows to chart',
    );
    expect(
      askRefusal(
        'answer-business-question',
        'build-visual',
        earlierRun({ answer: { ...run.answer!, data: undefined } }),
      ),
    ).toBe('The earlier answer has no query rows to chart');
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

  it("gives Jessica the earlier answer's records, plan, the quality findings of a run stored before that check left and notes", () => {
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

  it('gives Ryan the earlier question, answer, records and evidence', () => {
    const host = askHostOf(earlierRun(), 'build-visual');
    expect(host).toEqual({
      ask: {
        step: 'build-visual',
        earlier: {
          question: 'How many matches per year?',
          answer: 'There were 64 matches in 2022.',
          records: earlierRun().answer!.data,
          evidence: earlierRun().answer!.evidence,
        },
      },
      continuesThreads: true,
    });
  });

  it("gives Ryan the charted run's question and answer when the earlier run asked him alone", () => {
    const asked = earlierRun({
      id: 'run-2',
      question: 'As a bar chart',
      answer: {
        ...earlierRun().answer!,
        content: `Here's a new visual of the earlier answer: "Matches".`,
      },
    });
    const host = askHostOf(asked, 'build-visual', earlierRun());
    expect(host.ask.earlier).toMatchObject({
      question: 'How many matches per year?',
      answer: 'There were 64 matches in 2022.',
      records: asked.answer!.data,
    });
  });

  it('asks Olivia and Zoe as the step alone', () => {
    for (const step of ['plan', 'read-images'] as const) {
      expect(askHostOf(earlierRun(), step)).toEqual({
        ask: { step },
        continuesThreads: true,
      });
    }
  });
});

describe('chartedRunOf (agents.md 5.21)', () => {
  const askedOf = (id: string, fromRunId: string, askStep = 'build-visual') =>
    earlierRun({
      id,
      question: 'As a bar chart',
      context: { fromRunId, askStep } as WorkflowRunDoc['context'],
    });

  it('walks back over runs that asked Ryan alone, to the run whose answer he charts', async () => {
    const runs = new Map<string, WorkflowRunDoc>([
      ['run-1', earlierRun()],
      ['run-2', askedOf('run-2', 'run-1')],
    ]);
    const get = jest.fn((id: string) => Promise.resolve(runs.get(id) ?? null));
    const charted = await chartedRunOf(askedOf('run-3', 'run-2'), get);
    expect(charted.id).toBe('run-1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps a run that did not ask Ryan, and stops at the last run it can read', async () => {
    const get = jest.fn(() => Promise.resolve(null));
    expect((await chartedRunOf(earlierRun(), get)).id).toBe('run-1');
    expect(get).not.toHaveBeenCalled();
    const writer = askedOf('run-2', 'run-1', 'write-answer');
    expect((await chartedRunOf(writer, get)).id).toBe('run-2');
    expect((await chartedRunOf(askedOf('run-3', 'gone'), get)).id).toBe(
      'run-3',
    );
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
