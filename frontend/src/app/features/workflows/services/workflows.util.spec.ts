import { WorkflowInputField, WorkflowSummary } from '../models/workflow.model';
import {
  buildWorkflowSections,
  canRunFromPage,
  followUpRequest,
  initialInputValues,
  questionFieldName,
  isActiveRun,
  isLiveRun,
  runInput,
  filterRuns,
  runAgainValues,
  runRowStatus,
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
  personaInList,
  personaLabel,
  workflowKindLabel,
  workflowUsesLabel,
  workflowsEmptyMessage,
} from './workflows.util';

function workflow(
  id: string,
  name: string,
  overrides: Partial<WorkflowSummary> = {},
): WorkflowSummary {
  return {
    id,
    name,
    description: `${name} description`,
    kind: 'code',
    owner: 'Official',
    agents: [],
    stepCount: 4,
    trigger: 'run',
    input: [],
    datasets: [],
    missingDatasets: [],
    starterQuestions: [],
    ...overrides,
  };
}

/** A code workflow that calls no agent. */
const THREE_STEPS: WorkflowSummary = workflow('three-steps', 'Three steps', {
  stepCount: 3,
  input: [
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      required: true,
      placeholder: 'Paste or type any text',
    },
  ],
});

/** The catalogue as `GET /workflows` orders it (workflows R1), plus a second code workflow. */
const CATALOGUE: WorkflowSummary[] = [
  workflow('answer-business-question', 'Insights Analyst', {
    agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
    runRequirement: 'Set up an LLM first',
  }),
  workflow('report-steps', 'Report steps', {
    description: 'Answers about the health plan',
  }),
];

describe('workflows.util', () => {
  describe('buildWorkflowSections', () => {
    it('lists every workflow under Official in the catalogue order, with no Mine section (R5)', () => {
      const sections = buildWorkflowSections(CATALOGUE, '');
      expect(sections.map((section) => section.id)).toEqual(['official']);
      expect(sections.map((section) => section.label)).toEqual(['Official']);
      expect(sections[0].workflows.map((w) => w.id)).toEqual([
        'answer-business-question',
        'report-steps',
      ]);
    });

    it('filters by name or description, ignoring case and spaces around', () => {
      expect(
        buildWorkflowSections(CATALOGUE, '  insights ').flatMap((section) =>
          section.workflows.map((w) => w.id),
        ),
      ).toEqual(['answer-business-question']);
      const byDescription = buildWorkflowSections(CATALOGUE, 'HEALTH PLAN');
      expect(byDescription.map((section) => section.id)).toEqual(['official']);
      expect(byDescription[0].workflows.map((w) => w.id)).toEqual([
        'report-steps',
      ]);
    });

    it('returns no section when nothing matches', () => {
      expect(buildWorkflowSections(CATALOGUE, 'zzz')).toEqual([]);
    });
  });

  describe('workflowsEmptyMessage', () => {
    it('names the query when nothing matches', () => {
      expect(workflowsEmptyMessage(' zzz ', [])).toBe(
        'No user journeys match "zzz"',
      );
    });

    it('is null while a section shows', () => {
      expect(
        workflowsEmptyMessage(
          'report',
          buildWorkflowSections(CATALOGUE, 'report'),
        ),
      ).toBeNull();
    });
  });

  describe('labels', () => {
    it('reads "<n> steps" for every workflow (workflows R5)', () => {
      expect(workflowKindLabel(CATALOGUE[0])).toBe('4 steps');
      expect(workflowKindLabel(THREE_STEPS)).toBe('3 steps');
    });

    it('reads "1 step" for a workflow of one step', () => {
      expect(workflowKindLabel({ stepCount: 1 })).toBe('1 step');
      expect(workflowKindLabel({ stepCount: 0 })).toBe('0 steps');
    });

    it('says nothing about agents for a workflow that calls none', () => {
      expect(workflowUsesLabel(THREE_STEPS)).toBe('');
    });

    it('lists the agents the steps call', () => {
      expect(workflowUsesLabel(CATALOGUE[0])).toBe('Uses Insights Analyst');
      expect(
        workflowUsesLabel(
          workflow('x', 'X', {
            agents: [
              { key: 'a', name: 'A' },
              { key: 'b', name: 'B' },
            ],
          }),
        ),
      ).toBe('Uses A, B');
    });

    it('names each agent persona with its role (R39)', () => {
      expect(
        workflowUsesLabel(
          workflow('x', 'X', {
            agents: [
              {
                key: 'insights-analyst',
                name: 'Michael',
                role: 'Insights Analyst',
              },
              { key: 'answer-writer', name: 'Jessica', role: '' },
            ],
          }),
        ),
      ).toBe('Uses Michael (Insights Analyst), Jessica');
      expect(personaLabel({ name: 'Michael', role: 'Insights Analyst' })).toBe(
        'Michael, Insights Analyst',
      );
      expect(personaLabel({ name: 'Michael', role: '  ' })).toBe('Michael');
      expect(personaLabel({ name: 'Michael' })).toBe('Michael');
      expect(personaInList({ name: 'Zoe', role: 'Image Analyst' })).toBe(
        'Zoe (Image Analyst)',
      );
    });
  });

  describe('a run result (workflows R13, R21; api.md 3.6)', () => {
    const success = {
      status: 'success' as const,
      output: { summary: '1 word, 1 character: "a"', extra: { n: 1 } },
    };
    const failed = { status: 'failed' as const, error: 'The text is empty' };

    it('says "Run succeeded", "Run failed: <error>", "Run stopped" or "Running…"', () => {
      expect(runStatusLine(success)).toBe('Run succeeded');
      expect(runStatusLine(failed)).toBe('Run failed: The text is empty');
      expect(runStatusLine({ status: 'failed' })).toBe('Run failed');
      expect(runStatusLine({ status: 'stopped' })).toBe('Run stopped');
      expect(runStatusLine({ status: 'running' })).toBe('Running…');
      expect(runStatusLine({ status: 'queued' })).toBe('Queued…');
    });

    it('labels a step Running, Done, Failed, Skipped or Stopped', () => {
      expect(runStepStatusLabel('running')).toBe('Running');
      expect(runStepStatusLabel('success')).toBe('Done');
      expect(runStepStatusLabel('failed')).toBe('Failed');
      expect(runStepStatusLabel('skipped')).toBe('Skipped');
      expect(runStepStatusLabel('stopped')).toBe('Stopped');
    });

    it('shows each output field, a text as it is and anything else as JSON', () => {
      expect(runOutputEntries(success.output)).toEqual([
        {
          key: 'summary',
          value: '1 word, 1 character: "a"',
          structured: false,
        },
        { key: 'extra', value: '{\n  "n": 1\n}', structured: true },
      ]);
      expect(runOutputEntries(undefined)).toEqual([]);
    });

    it('shows a text with quotes unescaped, and numbers, booleans and null as they read', () => {
      expect(
        runOutputEntries({
          text: '"Hello" world',
          words: 2,
          stopped: false,
          x: null,
        }),
      ).toEqual([
        { key: 'text', value: '"Hello" world', structured: false },
        { key: 'words', value: '2', structured: false },
        { key: 'stopped', value: 'false', structured: false },
        { key: 'x', value: 'null', structured: false },
      ]);
    });
  });

  describe('runs from the page (workflows R21)', () => {
    const ASSISTANT_INPUT: WorkflowInputField[] = [
      { name: 'question', label: 'Question', type: 'textarea', required: true },
      { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      {
        name: 'careful',
        label: 'Careful: cross-check the result with an independent query',
        type: 'boolean',
        required: false,
        default: false,
      },
    ];

    it('a workflow with an input runs from its page; one without has no run form', () => {
      const runnable = [THREE_STEPS, ...CATALOGUE]
        .map((w) => ({
          ...w,
          input: w.input.length ? w.input : ASSISTANT_INPUT,
        }))
        .filter(canRunFromPage)
        .map((w) => w.id);
      expect(runnable).toEqual([
        'three-steps',
        'answer-business-question',
        'report-steps',
      ]);
      expect(canRunFromPage(workflow('no-input', 'No input'))).toBe(false);
    });

    it('the form starts from the defaults: a boolean unchecked unless its default is true', () => {
      expect(initialInputValues(ASSISTANT_INPUT)).toEqual({ careful: false });
      expect(
        initialInputValues([
          {
            name: 'on',
            label: 'On',
            type: 'boolean',
            required: false,
            default: true,
          },
          {
            name: 'n',
            label: 'N',
            type: 'number',
            required: false,
            default: 3,
          },
        ]),
      ).toEqual({ on: true, n: '3' });
    });

    it('sends each visible field as its type takes it, and leaves out what is untouched', () => {
      expect(
        runInput(ASSISTANT_INPUT, {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          careful: true,
          stray: 'ignored',
        }),
      ).toEqual({
        question: 'Which team scored the most goals?',
        datasets: ['World Cup Core'],
        careful: true,
      });
      expect(runInput(ASSISTANT_INPUT, {})).toEqual({ careful: false });
      expect(
        runInput(
          [
            { name: 'title', label: 'Title', type: 'text', required: true },
            {
              name: 'secret',
              label: 'Secret',
              type: 'text',
              required: false,
              hidden: true,
            },
          ],
          { title: 'World Cup Core', secret: 'r-1' },
        ),
      ).toEqual({ title: 'World Cup Core' });
    });

    it("the question field is the first visible text area: the follow-up's", () => {
      expect(questionFieldName(ASSISTANT_INPUT)).toBe('question');
      expect(
        questionFieldName([
          {
            name: 'message',
            label: 'Message',
            type: 'textarea',
            required: true,
          },
        ]),
      ).toBe('message');
      expect(questionFieldName([])).toBeNull();
    });

    it('a follow-up runs on the same input with the new question, and the earlier run as its context', () => {
      expect(
        followUpRequest(
          {
            id: 'run-1',
            input: {
              question: 'Which team scored the most goals?',
              datasets: ['World Cup Core'],
              careful: false,
            },
          },
          'question',
          '  And the fewest?  ',
        ),
      ).toEqual({
        input: {
          question: 'And the fewest?',
          datasets: ['World Cup Core'],
          careful: false,
        },
        context: { fromRunId: 'run-1' },
      });
    });
  });
});

describe('Runs list helpers (plan 1.24.11)', () => {
  const rows = [
    { id: 'aa11', title: 'Most goals?', workflowName: 'Assistant' },
    { id: 'bb22', title: 'Fewest goals?', workflowName: 'Insights Analyst' },
  ];

  it('searches a run by title, workflow name or id', () => {
    expect(filterRuns(rows, '')).toEqual(rows);
    expect(filterRuns(rows, 'FEWEST').map((r) => r.id)).toEqual(['bb22']);
    expect(filterRuns(rows, 'insights').map((r) => r.id)).toEqual(['bb22']);
    expect(filterRuns(rows, 'aa1').map((r) => r.id)).toEqual(['aa11']);
    expect(filterRuns(rows, 'nothing')).toEqual([]);
  });

  it('labels a run row status', () => {
    expect(runRowStatus('success')).toBe('Done');
    expect(runRowStatus('running')).toBe('Running');
    expect(runRowStatus('queued')).toBe('Queued');
  });

  it('tells a live run (queued or running) from an active one (also suspended)', () => {
    expect(isLiveRun('queued')).toBeTrue();
    expect(isLiveRun('running')).toBeTrue();
    expect(isLiveRun('suspended')).toBeFalse();
    expect(isActiveRun('queued')).toBeTrue();
    expect(isActiveRun('running')).toBeTrue();
    expect(isActiveRun('suspended')).toBeTrue();
    for (const ended of ['success', 'failed', 'stopped'] as const) {
      expect(isActiveRun(ended)).toBeFalse();
      expect(isLiveRun(ended)).toBeFalse();
    }
  });

  it('refills a form from a stored input, keeping the defaults of fields it lacks', () => {
    const fields = [
      { name: 'question', label: 'Question', type: 'textarea', required: true },
      { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      {
        name: 'careful',
        label: 'Careful',
        type: 'boolean',
        required: false,
        default: false,
      },
    ] as WorkflowInputField[];
    expect(
      runAgainValues(fields, {
        question: 'Why?',
        datasets: ['World Cup Core'],
      }),
    ).toEqual({
      careful: false,
      question: 'Why?',
      datasets: ['World Cup Core'],
    });
  });
});

describe('runAgainValues with an image field', () => {
  it("leaves the image out: a stored run holds the file's path, not the image", () => {
    expect(
      runAgainValues(
        [
          {
            name: 'image',
            label: 'Dashboard image',
            type: 'image',
            required: true,
          },
          {
            name: 'question',
            label: 'Instructions',
            type: 'textarea',
            required: false,
          },
        ],
        { image: 'inputs/image.png', question: 'Dark theme' },
      ),
    ).toEqual({ question: 'Dark theme' });
  });
});

describe('runInput and runAgainValues with an artifact field', () => {
  const fields: WorkflowInputField[] = [
    {
      name: 'image',
      label: 'Dashboard image',
      type: 'image',
      required: false,
      requiredWithout: 'artifact',
    },
    {
      name: 'artifact',
      label: 'Saved dashboard',
      type: 'artifact',
      required: false,
      requiredWithout: 'image',
      artifactKinds: ['dashboard'],
    },
  ];

  it('sends the artifact id as a string and nothing for an empty one', () => {
    expect(runInput(fields, { image: '', artifact: 'a-1' })).toEqual({
      artifact: 'a-1',
    });
    expect(runInput(fields, { image: '', artifact: '' })).toEqual({});
  });

  it('keeps the artifact id for Run again and drops the image', () => {
    expect(
      runAgainValues(fields, { artifact: 'a-1', image: 'inputs/image.png' }),
    ).toEqual({ artifact: 'a-1' });
  });
});

describe('reference images (an images field)', () => {
  const fields: WorkflowInputField[] = [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
    {
      name: 'images',
      label: 'Reference images',
      type: 'images',
      required: false,
      max: 4,
    },
  ];

  it('sends the images as a list, and nothing when there are none', () => {
    expect(
      runInput(fields, {
        question: 'Why?',
        images: ['data:image/png;base64,AAAA'],
      }),
    ).toEqual({ question: 'Why?', images: ['data:image/png;base64,AAAA'] });
    expect(runInput(fields, { question: 'Why?', images: [] })).toEqual({
      question: 'Why?',
    });
  });

  it('Run again leaves the images out: a stored run holds paths, not images', () => {
    expect(
      runAgainValues(fields, {
        question: 'Why?',
        images: ['inputs/images/1.png'],
      }),
    ).toEqual({ question: 'Why?' });
  });

  it('a follow-up carries the kept paths and the new images, or drops them', () => {
    const run = {
      id: 'r-1',
      input: { question: 'Why?', images: ['inputs/images/1.png'] },
    };
    expect(followUpRequest(run, 'question', ' And now? ')).toEqual({
      input: { question: 'And now?', images: ['inputs/images/1.png'] },
      context: { fromRunId: 'r-1' },
    });
    expect(
      followUpRequest(run, 'question', 'And now?', [
        'inputs/images/1.png',
        'data:image/png;base64,AAAA',
      ]).input,
    ).toEqual({
      question: 'And now?',
      images: ['inputs/images/1.png', 'data:image/png;base64,AAAA'],
    });
    expect(followUpRequest(run, 'question', 'And now?', []).input).toEqual({
      question: 'And now?',
    });
  });
});
