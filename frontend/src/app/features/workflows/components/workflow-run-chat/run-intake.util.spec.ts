import { WorkflowInputField } from '../../models/workflow.model';
import {
  IntakeWorkflow,
  andList,
  artifactOption,
  askText,
  composerPlaceholder,
  continueLabel,
  datasetOption,
  emptyHint,
  fieldAgent,
  intakeKind,
  leadVoice,
  missingFields,
  optionLabel,
  pendingPlaceholder,
  promptField,
  refusalText,
  shownOptions,
  typedOption,
} from './run-intake.util';

const QUESTION: WorkflowInputField = {
  name: 'question',
  label: 'Question',
  type: 'textarea',
  required: true,
};
const DATASETS: WorkflowInputField = {
  name: 'datasets',
  label: 'Datasets',
  type: 'datasets',
  required: true,
  usedBy: ['avery'],
};
const APPROVE: WorkflowInputField = {
  name: 'approveSteps',
  label: "Approve each step: every agent's work waits for your OK",
  type: 'boolean',
  required: false,
  default: true,
};

/** Answer a Business Question (Avery + Michael). */
const AVERY: IntakeWorkflow = {
  name: 'Answer a Business Question',
  input: [QUESTION, DATASETS, APPROVE],
  agents: [{ name: 'Avery', role: 'Orchestrator' }],
  steps: [
    {
      id: 'avery',
      agent: {
        name: 'Avery',
        role: 'Orchestrator',
        team: [{ name: 'Michael', role: 'Data analyst' }],
      },
    },
  ],
};

const CODE_ONLY: IntakeWorkflow = {
  name: 'Review a Website',
  input: [
    { name: 'url', label: 'Entry URL', type: 'text', required: true },
    {
      name: 'maxPages',
      label: 'Max pages',
      type: 'number',
      required: false,
      default: 10,
    },
  ],
  agents: [],
  steps: [{ id: 'crawl' }],
};

describe('run-intake.util (the run chat asks for missing inputs)', () => {
  describe('the voice', () => {
    it('is the orchestrator, with its role and initial', () => {
      expect(leadVoice(AVERY)).toEqual({
        name: 'Avery',
        role: 'Orchestrator',
        initial: 'A',
        agent: true,
      });
      expect(composerPlaceholder(AVERY)).toBe('Message Avery');
    });

    it("is the workflow's only agent without an orchestrator", () => {
      const solo: IntakeWorkflow = {
        ...AVERY,
        agents: [{ name: 'Grace', role: 'Dashboard reader' }],
        steps: [{ id: 'read', agent: { name: 'Grace' } }],
      };
      expect(leadVoice(solo).name).toBe('Grace');
      expect(composerPlaceholder(solo)).toBe('Message Grace');
    });

    it('is the workflow itself with no agent or several', () => {
      expect(leadVoice(CODE_ONLY)).toEqual({
        name: 'Review a Website',
        role: '',
        initial: 'R',
        agent: false,
      });
      expect(composerPlaceholder(CODE_ONLY)).toBe('Message Review a Website');
    });
  });

  describe('the empty state hint', () => {
    it('names the lead and its team for a data workflow', () => {
      expect(emptyHint(AVERY)).toBe(
        'Ask Avery and Michael anything about your data.',
      );
    });

    it('names the agents without data, and the workflow without agents', () => {
      expect(
        emptyHint({
          ...CODE_ONLY,
          agents: [{ name: 'Iris' }, { name: 'Sam' }, { name: 'Lee' }],
        }),
      ).toBe('Tell Iris, Sam and Lee what you need.');
      expect(emptyHint(CODE_ONLY)).toBe(
        'Send a message to run Review a Website.',
      );
    });

    it('andList joins one, two and three names', () => {
      expect(andList(['A'])).toBe('A');
      expect(andList(['A', 'B'])).toBe('A and B');
      expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
      expect(andList([])).toBe('');
    });
  });

  describe('the prompt field', () => {
    it('is the question when there is one', () => {
      expect(promptField(AVERY.input, 'question')?.name).toBe('question');
    });

    it('is the first required text field without a question', () => {
      expect(promptField(CODE_ONLY.input, null)?.name).toBe('url');
      expect(promptField([DATASETS], null)).toBeNull();
    });
  });

  describe('missing fields', () => {
    it('lists required visible fields with no value, in declared order', () => {
      const fields: WorkflowInputField[] = [
        { ...DATASETS },
        QUESTION,
        { name: 'url', label: 'URL', type: 'text', required: true },
        {
          name: 'secret',
          label: 'S',
          type: 'text',
          required: true,
          hidden: true,
        },
        { name: 'note', label: 'Note', type: 'text', required: false },
      ];
      expect(
        missingFields(fields, { question: 'Why?', url: '  ' }).map(
          (f) => f.name,
        ),
      ).toEqual(['datasets', 'url']);
    });

    it('does not ask a field filled already (picked, typed, a number, a default)', () => {
      const fields: WorkflowInputField[] = [
        DATASETS,
        QUESTION,
        { name: 'n', label: 'N', type: 'number', required: true },
      ];
      expect(
        missingFields(fields, { datasets: ['World Cup'], question: 'Q', n: 3 }),
      ).toEqual([]);
    });

    it('asks a required checkbox with no default until it is answered', () => {
      const sure: WorkflowInputField = {
        name: 'sure',
        label: 'Are you sure',
        type: 'boolean',
        required: true,
      };
      expect(missingFields([sure, APPROVE], { sure: false })).toEqual([sure]);
      expect(missingFields([sure], { sure: false }, new Set(['sure']))).toEqual(
        [],
      );
      expect(
        missingFields([{ ...sure, default: false }], { sure: false }),
      ).toEqual([]);
    });

    it('asks only the first of two fields that stand in for each other, and neither once one has a value', () => {
      const image: WorkflowInputField = {
        name: 'image',
        label: 'Dashboard image',
        type: 'image',
        required: true,
        requiredWithout: 'artifact',
      };
      const artifact: WorkflowInputField = {
        name: 'artifact',
        label: 'Saved dashboard',
        type: 'artifact',
        required: true,
        requiredWithout: 'image',
      };
      expect(missingFields([artifact, image], {}).map((f) => f.name)).toEqual([
        'artifact',
      ]);
      expect(missingFields([artifact, image], { image: 'data:x' })).toEqual([]);
    });
  });

  describe('the question for a field', () => {
    it("names the lead's teammate for the data, after a typed message", () => {
      expect(fieldAgent(DATASETS, AVERY)).toBe('Michael');
      expect(askText(DATASETS, AVERY, { first: true, typed: true })).toBe(
        'Happy to. First, which data should Michael look at? Pick one or more datasets.',
      );
    });

    it('says "should I" when the field is for the agent that asks', () => {
      const solo: IntakeWorkflow = {
        name: 'Assess Data Readiness',
        input: [],
        agents: [{ name: 'Dana' }],
        steps: [{ id: 'assess', agent: { name: 'Dana' } }],
      };
      const dataset: WorkflowInputField = {
        name: 'dataset',
        label: 'Dataset',
        type: 'dataset',
        required: true,
        usedBy: ['assess'],
      };
      expect(askText(dataset, solo, { first: true, typed: false })).toBe(
        'First, which dataset should I look at? Pick one.',
      );
    });

    it('phrases each kind, later ones with "Thanks. Next,"', () => {
      const next = { first: false, typed: true };
      const ask = (field: WorkflowInputField) =>
        askText(field, CODE_ONLY, next);
      expect(ask(CODE_ONLY.input[0])).toBe(
        'Thanks. Next, what is the entry URL?',
      );
      expect(
        ask({
          name: 'a',
          label: 'Saved dashboard',
          type: 'artifact',
          required: true,
        }),
      ).toBe('Thanks. Next, which saved dashboard should I use? Pick one.');
      expect(
        ask({
          name: 'i',
          label: 'Dashboard image',
          type: 'image',
          required: true,
        }),
      ).toBe(
        'Thanks. Next, please add the dashboard image: drop, paste or pick an image.',
      );
      expect(
        ask({
          name: 'b',
          label: 'Overwrite it',
          type: 'boolean',
          required: true,
        }),
      ).toBe('Thanks. Next, overwrite it?');
    });

    it('maps each type to how it is answered', () => {
      expect(intakeKind(DATASETS)).toBe('pick-many');
      expect(intakeKind({ ...DATASETS, type: 'dataset' })).toBe('pick-one');
      expect(intakeKind({ ...DATASETS, type: 'artifact' })).toBe('pick-one');
      expect(intakeKind({ ...DATASETS, type: 'image' })).toBe('image');
      expect(intakeKind({ ...DATASETS, type: 'images' })).toBe('image');
      expect(intakeKind({ ...DATASETS, type: 'boolean' })).toBe('yes-no');
      expect(intakeKind({ ...DATASETS, type: 'number' })).toBe('text');
      expect(intakeKind(QUESTION)).toBe('text');
    });

    it('gives the composer a placeholder for the field it waits on', () => {
      expect(pendingPlaceholder(DATASETS, 'Message Avery')).toBe(
        'Or type a dataset name…',
      );
      expect(
        pendingPlaceholder(
          {
            name: 'a',
            label: 'Saved dashboard',
            type: 'artifact',
            required: true,
          },
          'x',
        ),
      ).toBe('Or type a saved dashboard name…');
      expect(pendingPlaceholder(CODE_ONLY.input[0], 'x')).toBe(
        'Type the entry URL…',
      );
      expect(
        pendingPlaceholder(
          { ...CODE_ONLY.input[0], placeholder: 'https://…' },
          'x',
        ),
      ).toBe('https://…');
      expect(pendingPlaceholder({ ...QUESTION, type: 'boolean' }, 'x')).toBe(
        'x',
      );
    });
  });

  describe('the choices', () => {
    const kindLabel = (kind: string | undefined) =>
      kind === 'postgres'
        ? 'PostgreSQL'
        : kind === 'file'
          ? 'Excel / CSV'
          : 'Unknown';

    it('reads a dataset as its kind and table count', () => {
      expect(
        datasetOption(
          {
            name: 'World Cup',
            datasourceKind: 'postgres',
            tables: Array(9).fill('t'),
          },
          kindLabel,
        ),
      ).toEqual({
        id: 'World Cup',
        name: 'World Cup',
        detail: 'PostgreSQL · 9 tables',
        icon: 'database',
      });
      expect(
        datasetOption(
          { name: 'Sheet', datasourceKind: 'file', tables: ['a'] },
          kindLabel,
        ),
      ).toEqual(
        jasmine.objectContaining({
          detail: 'Excel / CSV · 1 table',
          icon: 'file',
        }),
      );
      expect(
        datasetOption({ name: 'Bare', tables: [] }, kindLabel).detail,
      ).toBe('0 tables');
    });

    it('reads an artifact as its kind and widget count', () => {
      expect(
        artifactOption({
          id: 'a1',
          name: 'Sales',
          kind: 'dashboard',
          widgetCount: 1,
        }),
      ).toEqual({
        id: 'a1',
        name: 'Sales',
        detail: 'Dashboard · 1 widget',
        icon: 'dashboard',
      });
    });

    const OPTIONS = [
      'World Cup',
      'World Cup Medallion',
      'US Health',
      'Formula 1',
      'Excel',
      'F2',
    ].map((name) => ({
      id: name,
      name,
      detail: '',
      icon: 'database' as const,
    }));

    it('shows the first five, all on request, and filters by a typed name', () => {
      expect(shownOptions(OPTIONS, '', false).shown.length).toBe(5);
      expect(shownOptions(OPTIONS, '', false).total).toBe(6);
      expect(shownOptions(OPTIONS, '', true).shown.length).toBe(6);
      expect(
        shownOptions(OPTIONS, ' world ', false).shown.map((o) => o.name),
      ).toEqual(['World Cup', 'World Cup Medallion']);
    });

    it('a typed name picks the exact match, else the only match', () => {
      expect(typedOption(OPTIONS, 'world cup')?.name).toBe('World Cup');
      expect(typedOption(OPTIONS, 'health')?.name).toBe('US Health');
      expect(typedOption(OPTIONS, 'f')).toBeNull();
      expect(typedOption(OPTIONS, '  ')).toBeNull();
    });

    it('labels Continue with the count', () => {
      expect(continueLabel(1)).toBe('Continue with 1 dataset');
      expect(continueLabel(3)).toBe('Continue with 3 datasets');
    });
  });

  it('words a refusal as the agent', () => {
    expect(
      refusalText(['Entry URL must be a URL.', 'Max pages must be at most 50']),
    ).toBe(
      "I couldn't start yet: Entry URL must be a URL. Max pages must be at most 50.",
    );
    expect(refusalText([])).toBe("I couldn't start the run.");
  });

  it('splits a checkbox label at its colon', () => {
    expect(optionLabel(APPROVE.label)).toEqual({
      title: 'Approve each step',
      detail: "every agent's work waits for your OK",
    });
    expect(optionLabel('Mobile (390 px)')).toEqual({
      title: 'Mobile (390 px)',
      detail: '',
    });
  });
});
