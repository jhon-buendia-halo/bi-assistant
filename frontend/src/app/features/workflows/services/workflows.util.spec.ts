import { WorkflowInputField, WorkflowSummary } from '../models/workflow.model';
import {
  buildWorkflowSections,
  canRunFromPage,
  continueRequest,
  followUpRequest,
  initialInputValues,
  rfpDocumentItem,
  rfpPackageFilename,
  questionFieldName,
  runInput,
  filterRuns,
  runAgainValues,
  runRowStatus,
  chatWorkflows,
  composerCreateBody,
  composerWorkflowId,
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
  workflowKindLabel,
  workflowStartAction,
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
    kind: 'agent',
    owner: 'Official',
    agents: [{ key: id.replace(/^agent:/, ''), name }],
    stepCount: 1,
    bar: 'agent',
    trigger: 'chat',
    input: [],
    picksDatasets: false,
    datasets: [],
    missingDatasets: [],
    starterQuestions: [],
    ...overrides,
  };
}

/** The sequential test workflow: a run workflow (plan 9.1). */
const SEQ: WorkflowSummary = workflow('seq-text-demo', 'Sequential test workflow', {
  kind: 'code',
  stepCount: 3,
  bar: 'steps',
  trigger: 'run',
  agents: [],
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

/** The catalogue as `GET /workflows` orders it (workflows R1). */
const CATALOGUE: WorkflowSummary[] = [
  workflow('agent:assistant', 'Assistant', {
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  }),
  workflow('qti-v2-turn', 'Questions to Insights v2', {
    kind: 'code',
    stepCount: 4,
    bar: 'steps',
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  }),
  workflow('agent:data-readiness', 'Data Readiness Agent'),
  workflow('agent:rfp', 'RFP Builder', {
    chatRequirement:
      'Load the "Intellify RFP API" sample in Settings → Testing Data first',
  }),
  workflow('agent:u2', 'Zeta analyst', { owner: 'You' }),
  workflow('agent:u1', 'Alpha analyst', {
    owner: 'You',
    description: 'Answers about the health plan',
  }),
];

describe('workflows.util', () => {
  describe('buildWorkflowSections', () => {
    it('groups Official then Mine and keeps the catalogue order in each (R5)', () => {
      const sections = buildWorkflowSections(CATALOGUE, '');
      expect(sections.map((section) => section.id)).toEqual([
        'official',
        'mine',
      ]);
      expect(sections.map((section) => section.label)).toEqual([
        'Official',
        'Mine',
      ]);
      expect(sections[0].workflows.map((w) => w.id)).toEqual([
        'agent:assistant',
        'qti-v2-turn',
        'agent:data-readiness',
        'agent:rfp',
      ]);
      // The server orders user workflows by name; the list never re-sorts.
      expect(sections[1].workflows.map((w) => w.id)).toEqual([
        'agent:u2',
        'agent:u1',
      ]);
    });

    it('omits Mine when there are no user workflows', () => {
      const sections = buildWorkflowSections(
        CATALOGUE.filter((w) => w.owner === 'Official'),
        '',
      );
      expect(sections.map((section) => section.id)).toEqual(['official']);
    });

    it('filters by name or description, ignoring case and spaces around', () => {
      expect(
        buildWorkflowSections(CATALOGUE, '  rfp ').flatMap((section) =>
          section.workflows.map((w) => w.id),
        ),
      ).toEqual(['agent:rfp']);
      const byDescription = buildWorkflowSections(CATALOGUE, 'HEALTH PLAN');
      expect(byDescription.map((section) => section.id)).toEqual(['mine']);
      expect(byDescription[0].workflows.map((w) => w.id)).toEqual([
        'agent:u1',
      ]);
    });

    it('returns no section when nothing matches', () => {
      expect(buildWorkflowSections(CATALOGUE, 'zzz')).toEqual([]);
    });
  });

  describe('workflowsEmptyMessage', () => {
    it('names the query when nothing matches', () => {
      expect(workflowsEmptyMessage(' zzz ', [])).toBe(
        'No workflows match "zzz"',
      );
    });

    it('is null while a section shows', () => {
      expect(
        workflowsEmptyMessage('rfp', buildWorkflowSections(CATALOGUE, 'rfp')),
      ).toBeNull();
    });
  });

  describe('labels', () => {
    it('reads "<n> steps" for a code-defined workflow and "One step" otherwise', () => {
      expect(workflowKindLabel(CATALOGUE[1])).toBe('4 steps');
      expect(workflowKindLabel(CATALOGUE[0])).toBe('One step');
    });

    it('reads "Runs on an input" for a run workflow (workflows R12)', () => {
      expect(workflowKindLabel(SEQ)).toBe('Runs on an input');
    });

    it('says nothing about agents for a workflow that calls none', () => {
      expect(workflowUsesLabel(SEQ)).toBe('');
    });

    it('lists the agents the steps call', () => {
      expect(workflowUsesLabel(CATALOGUE[0])).toBe(
        'Uses Questions to Insights Assistant',
      );
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
  });

  describe('workflowStartAction (R6)', () => {
    it('opens the composer on the assistant workflow for the assistant workflow', () => {
      expect(workflowStartAction(CATALOGUE[0])).toEqual({
        kind: 'composer',
        workflowId: 'agent:assistant',
      });
    });

    it('opens the composer preselected to a dataset-picking code workflow', () => {
      expect(workflowStartAction(CATALOGUE[1])).toEqual({
        kind: 'composer',
        workflowId: 'qti-v2-turn',
      });
    });

    it('creates the session at once for any other workflow', () => {
      expect(workflowStartAction(CATALOGUE[2])).toEqual({ kind: 'create' });
      expect(workflowStartAction(CATALOGUE[4])).toEqual({ kind: 'create' });
    });
  });

  describe('chatWorkflows (sessions-chat R64)', () => {
    it('keeps the chat workflows in catalogue order and drops the run workflows', () => {
      const listed = [CATALOGUE[0], CATALOGUE[1], SEQ, ...CATALOGUE.slice(2)];
      expect(chatWorkflows(listed)).toEqual(CATALOGUE);
    });
  });

  describe('composerWorkflowId (sessions-chat R64)', () => {
    it('falls back to Assistant for a run workflow', () => {
      expect(composerWorkflowId([...CATALOGUE, SEQ], 'seq-text-demo')).toBe(
        'agent:assistant',
      );
    });

    it('keeps a preselected workflow that can start a chat', () => {
      expect(composerWorkflowId(CATALOGUE, 'qti-v2-turn')).toBe('qti-v2-turn');
      expect(composerWorkflowId(CATALOGUE, 'agent:u1')).toBe('agent:u1');
    });

    it('falls back to Assistant with nothing preselected, an unknown id or a disabled workflow', () => {
      expect(composerWorkflowId(CATALOGUE, undefined)).toBe('agent:assistant');
      expect(composerWorkflowId(CATALOGUE, 'agent:gone')).toBe(
        'agent:assistant',
      );
      expect(composerWorkflowId(CATALOGUE, 'agent:rfp')).toBe(
        'agent:assistant',
      );
      expect(composerWorkflowId([], 'qti-v2-turn')).toBe('agent:assistant');
    });

    it('takes workflow ids only: an agent key falls back to Assistant', () => {
      expect(composerWorkflowId(CATALOGUE, 'assistant-v2')).toBe(
        'agent:assistant',
      );
    });
  });

  describe('composerCreateBody (sessions-chat R64; api.md 3)', () => {
    it('sends the name and the picked datasets for a workflow that picks datasets', () => {
      expect(
        composerCreateBody(CATALOGUE[1], 'V2 check', ['World Cup Core']),
      ).toEqual({
        workflowId: 'qti-v2-turn',
        name: 'V2 check',
        datasets: ['World Cup Core'],
      });
      expect(composerCreateBody(null, 'Q', ['Core'])).toEqual({
        workflowId: 'agent:assistant',
        name: 'Q',
        datasets: ['Core'],
      });
    });

    it('sends no datasets, and the name only when typed, for any other workflow', () => {
      expect(composerCreateBody(CATALOGUE[3], 'Acme', ['Core'])).toEqual({
        workflowId: 'agent:rfp',
        name: 'Acme',
      });
      expect(composerCreateBody(CATALOGUE[3], '', ['Core'])).toEqual({
        workflowId: 'agent:rfp',
      });
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
        { key: 'summary', value: '1 word, 1 character: "a"', structured: false },
        { key: 'extra', value: '{\n  "n": 1\n}', structured: true },
      ]);
      expect(runOutputEntries(undefined)).toEqual([]);
    });

    it('shows a text with quotes unescaped, and numbers, booleans and null as they read', () => {
      expect(
        runOutputEntries({ text: '"Hello" world', words: 2, stopped: false, x: null }),
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

    it('the run workflows and every agent workflow (the Assistant, v2, Data Readiness, the RFP Builder and user agents) run from their page', () => {
      const runnable = [SEQ, ...CATALOGUE]
        .map((w) => ({ ...w, input: w.input.length ? w.input : ASSISTANT_INPUT }))
        .filter(canRunFromPage)
        .map((w) => w.id);
      expect(runnable).toEqual([
        'seq-text-demo',
        'agent:assistant',
        'qti-v2-turn',
        'agent:data-readiness',
        'agent:rfp',
        'agent:u2',
        'agent:u1',
      ]);
      expect(canRunFromPage(workflow('agent:assistant', 'Assistant'))).toBe(false);
    });

    it('the form starts from the defaults: a boolean unchecked unless its default is true', () => {
      expect(initialInputValues(ASSISTANT_INPUT)).toEqual({ careful: false });
      expect(
        initialInputValues([
          { name: 'on', label: 'On', type: 'boolean', required: false, default: true },
          { name: 'n', label: 'N', type: 'number', required: false, default: 3 },
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
            { name: 'dataset', label: 'Dataset', type: 'dataset', required: true },
            { name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true },
          ],
          { dataset: 'World Cup Core', rfpId: 'r-1' },
        ),
      ).toEqual({ dataset: 'World Cup Core' });
    });

    it("the question field is the first visible text area: the follow-up's", () => {
      expect(questionFieldName(ASSISTANT_INPUT)).toBe('question');
      expect(
        questionFieldName([
          { name: 'message', label: 'Message', type: 'textarea', required: true },
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
        input: { question: 'And the fewest?', datasets: ['World Cup Core'], careful: false },
        context: { fromRunId: 'run-1' },
      });
    });
  });

  describe('the RFP Builder, one exchange per run (plan 4.3; rfp R2, R9, R16)', () => {
    const RFP_INPUT: WorkflowInputField[] = [
      {
        name: 'message',
        label: 'Message',
        type: 'textarea',
        required: true,
        placeholder: 'Name the client and plan year, or state your decision',
      },
      { name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true },
    ];

    it("Continue sends the typed message, the earlier run's RFP and the earlier run as its context", () => {
      expect(
        continueRequest(
          RFP_INPUT,
          { message: '  yes  ', rfpId: 'stale' },
          { id: 'run-1', rfpId: 'rfp-1' },
        ),
      ).toEqual({
        input: { message: '  yes  ', rfpId: 'rfp-1' },
        context: { fromRunId: 'run-1' },
      });
      // A run that only proposed (no RFP yet) is continued by its context alone.
      expect(continueRequest(RFP_INPUT, { message: 'yes' }, { id: 'run-1' })).toEqual({
        input: { message: 'yes' },
        context: { fromRunId: 'run-1' },
      });
    });

    it('names the package as the server does: rfp-<title>[-draft].zip, or the file itself', () => {
      const pkg = {
        rfpId: '0b6c1f2e-1111-2222-3333-444455556666',
        title: 'Orchard Manufacturing — 2027 benefits RFP',
        files: [],
      };
      expect(rfpPackageFilename(pkg)).toBe(
        'rfp-orchard-manufacturing-2027-benefits-rfp.zip',
      );
      expect(rfpPackageFilename({ ...pkg, draft: true })).toBe(
        'rfp-orchard-manufacturing-2027-benefits-rfp-draft.zip',
      );
      expect(rfpPackageFilename({ ...pkg, title: '—' })).toBe('rfp-0b6c1f2e.zip');
      expect(rfpPackageFilename(pkg, 'exhibits/exhibit-a-census.csv')).toBe(
        'exhibit-a-census.csv',
      );
    });

    it("the RFP document is the run's latest rfp.md file item, final or draft", () => {
      const file = (id: string, path: string, shownAt: string) => ({
        id,
        kind: 'file' as const,
        title: path,
        path,
        bytes: 10,
        shownAt,
      });
      expect(rfpDocumentItem(undefined)).toBeNull();
      expect(
        rfpDocumentItem([
          file('p1', 'notes.md', '2026-11-11T10:00:03.000Z'),
          file('p2', 'rfp/r-1/draft/rfp.md', '2026-11-11T10:00:01.000Z'),
          file('p3', 'rfp/r-1/rfp.md', '2026-11-11T10:00:02.000Z'),
          {
            id: 'p4',
            kind: 'document' as const,
            title: 'rfp/r-1/rfp.md',
            markdown: '# x',
            shownAt: '2026-11-11T10:00:04.000Z',
          },
        ])?.id,
      ).toBe('p3');
      expect(
        rfpDocumentItem([file('p1', 'exhibits/rfp.md', '2026-11-11T10:00:00.000Z')]),
      ).toBeNull();
    });
  });
});

describe('Runs list helpers (plan 1.24.11)', () => {
  const rows = [
    { id: 'aa11', title: 'Most goals?', workflowName: 'Assistant' },
    { id: 'bb22', title: 'Fewest goals?', workflowName: 'Questions to Insights v2' },
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
  });

  it('refills a form from a stored input, keeping the defaults of fields it lacks', () => {
    const fields = [
      { name: 'question', label: 'Question', type: 'textarea', required: true },
      { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      { name: 'careful', label: 'Careful', type: 'boolean', required: false, default: false },
    ] as WorkflowInputField[];
    expect(
      runAgainValues(fields, { question: 'Why?', datasets: ['World Cup Core'] }),
    ).toEqual({ careful: false, question: 'Why?', datasets: ['World Cup Core'] });
  });
});
