import { CODE_WORKFLOWS } from './workflow-catalog';
import {
  inputFieldsWithUsage,
  validateWorkflowInput,
  type InputWorkflowShape,
  type WorkflowInputField,
} from './workflow-input';

// That the input node covers every step (workflows R14) is now part of the
// data contract's check: workflow-contract.spec.ts (`missing`).

describe('usedBy: the steps that read a field from the input (api.md 116)', () => {
  it("qti-v2-turn's question and datasets are read by Receive question only", () => {
    expect(
      inputFieldsWithUsage(CODE_WORKFLOWS[0]).map(({ name, usedBy }) => ({
        name,
        usedBy,
      })),
    ).toEqual([
      { name: 'question', usedBy: ['receive-question'] },
      { name: 'datasets', usedBy: ['receive-question'] },
    ]);
  });

  it('lists every direct reader in step order, stops at an earlier output, and leaves an unread field empty', () => {
    const workflow: InputWorkflowShape = {
      input: [
        { name: 'q', label: 'Q', type: 'text', required: true },
        { name: 'n', label: 'N', type: 'number', required: false },
        { name: 'unused', label: 'Unused', type: 'boolean', required: false },
      ],
      steps: [
        { id: 's1', input: ['q', 'n'], output: ['n2'] },
        { id: 's2', input: ['n', 'n2'], output: ['q'] },
        { id: 's3', input: ['q', 'n'], output: [] },
      ],
    };
    expect(
      inputFieldsWithUsage(workflow).map(({ name, usedBy }) => [name, usedBy]),
    ).toEqual([
      ['q', ['s1']],
      ['n', ['s1', 's2', 's3']],
      ['unused', []],
    ]);
  });

  it('keeps every field property and returns copies', () => {
    const field: WorkflowInputField = {
      name: 'dataset',
      label: 'Dataset',
      type: 'dataset',
      required: true,
      datasourceKinds: ['postgres'],
    };
    const workflow = {
      input: [field],
      steps: [{ id: 'x', input: ['dataset'], output: [] }],
    };
    const [detail] = inputFieldsWithUsage(workflow);
    expect(detail).toEqual({ ...field, usedBy: ['x'] });
    detail.datasourceKinds!.push('rest');
    detail.usedBy.push('y');
    expect(field.datasourceKinds).toEqual(['postgres']);
    expect(inputFieldsWithUsage(workflow)[0].usedBy).toEqual(['x']);
  });
});

describe('validateWorkflowInput (api.md 118, 119)', () => {
  const fields: WorkflowInputField[] = [
    { name: 'text', label: 'Text', type: 'textarea', required: true },
    { name: 'title', label: 'Title', type: 'text', required: false },
    { name: 'limit', label: 'Limit', type: 'number', required: false },
    { name: 'count', label: 'Count', type: 'number', required: true },
  ];
  const check = (
    input: unknown,
    workflowFields: WorkflowInputField[] = fields,
    datasets?: { name: string; datasourceKind?: string }[],
  ) => validateWorkflowInput({ input: workflowFields }, input, { datasets });
  /** The first refusal's message: what `message` of the 400 says. */
  const first = (
    input: unknown,
    workflowFields: WorkflowInputField[] = fields,
    datasets?: { name: string; datasourceKind?: string }[],
  ) => {
    const result = check(input, workflowFields, datasets);
    return result.ok ? undefined : result.errors[0];
  };

  it('keeps the declared fields, numbers as numbers, and drops anything else', () => {
    expect(
      check({
        text: '  Hello  ',
        title: 'T',
        limit: '12.5',
        count: 3,
        extra: 'x',
      }),
    ).toEqual({
      ok: true,
      input: { text: '  Hello  ', title: 'T', limit: 12.5, count: 3 },
    });
  });

  it.each(['   ', '\n\t ', ''])(
    'refuses a required text that is whitespace-only or empty (%p) as missing',
    (text) => {
      expect(check({ text, count: 1 })).toEqual({
        ok: false,
        errors: [{ field: 'text', message: 'Text is required' }],
      });
    },
  );

  it('leaves out an optional field that is missing, empty or whitespace-only', () => {
    expect(check({ text: 'a', count: 1, limit: '', title: '   ' })).toEqual({
      ok: true,
      input: { text: 'a', count: 1 },
    });
  });

  it.each([
    [{ count: 1 }, 'text', 'Text is required'],
    [{ text: null, count: 1 }, 'text', 'Text is required'],
    [{ text: { a: 1 }, count: 1 }, 'text', 'Text is required'],
    [{ text: 'a' }, 'count', 'Count is required'],
    [{ text: 'a', count: '' }, 'count', 'Count is required'],
    [{ text: 'a', count: 'many' }, 'count', 'Count must be a number'],
    [{ text: 'a', count: 1, limit: 'ten' }, 'limit', 'Limit must be a number'],
    [{ text: 'a', count: Number.NaN }, 'count', 'Count must be a number'],
  ])('refuses %p on %p with %p', (input, field, message) => {
    expect(check(input)).toEqual({ ok: false, errors: [{ field, message }] });
  });

  it('collects every refusal, in field order, one per field', () => {
    expect(check({ count: 'many', limit: 'ten', title: 'ok' })).toEqual({
      ok: false,
      errors: [
        { field: 'text', message: 'Text is required' },
        { field: 'limit', message: 'Limit must be a number' },
        { field: 'count', message: 'Count must be a number' },
      ],
    });
  });

  it('treats a missing or non-object input as empty', () => {
    expect(check(undefined)).toEqual({
      ok: false,
      errors: [
        { field: 'text', message: 'Text is required' },
        { field: 'count', message: 'Count is required' },
      ],
    });
    expect(check('nope', [])).toEqual({ ok: true, input: {} });
  });

  describe('rules: maxLength, min and max', () => {
    const ruled: WorkflowInputField[] = [
      {
        name: 'question',
        label: 'Question',
        type: 'textarea',
        required: true,
        maxLength: 5,
      },
      {
        name: 'rows',
        label: 'Rows',
        type: 'number',
        required: false,
        min: 1,
        max: 10,
      },
    ];

    it('accepts a text of maxLength characters, counted after trimming', () => {
      expect(check({ question: '  12345\n', rows: 1 }, ruled)).toEqual({
        ok: true,
        input: { question: '  12345\n', rows: 1 },
      });
    });

    it('refuses a longer text', () => {
      expect(first({ question: '123456' }, ruled)).toEqual({
        field: 'question',
        message: 'Question must be at most 5 characters',
      });
    });

    it.each([
      [0, 'Rows must be at least 1'],
      ['11', 'Rows must be at most 10'],
    ])('refuses %p outside min and max with %p', (rows, message) => {
      expect(first({ question: 'q', rows }, ruled)).toEqual({
        field: 'rows',
        message,
      });
    });

    it('accepts the bounds themselves', () => {
      expect(check({ question: 'q', rows: 10 }, ruled)).toEqual({
        ok: true,
        input: { question: 'q', rows: 10 },
      });
    });
  });

  describe('boolean, datasets and dataset (plan 4.1)', () => {
    const datasets = [
      { name: 'World Cup Core', datasourceKind: 'postgres' },
      { name: 'Claims', datasourceKind: 'databricks' },
      { name: 'Orders API', datasourceKind: 'rest' },
      { name: 'Unbound' },
    ];
    const ask: WorkflowInputField[] = [
      { name: 'question', label: 'Question', type: 'textarea', required: true },
      { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      {
        name: 'careful',
        label: 'Careful',
        type: 'boolean',
        required: false,
        default: false,
      },
    ];
    const readiness: WorkflowInputField[] = [
      {
        name: 'dataset',
        label: 'Dataset',
        type: 'dataset',
        required: true,
        datasourceKinds: ['postgres', 'databricks'],
      },
      {
        name: 'question',
        label: 'Question',
        type: 'textarea',
        required: false,
        default: 'Assess the readiness of this dataset',
      },
    ];

    it('keeps the datasets in order without repeats, and a boolean as is', () => {
      expect(
        check(
          {
            question: 'Who won?',
            datasets: ['Claims', ' World Cup Core ', 'Claims'],
            careful: true,
          },
          ask,
          datasets,
        ),
      ).toEqual({
        ok: true,
        input: {
          question: 'Who won?',
          datasets: ['Claims', 'World Cup Core'],
          careful: true,
        },
      });
    });

    it('gives a missing field its default: false for careful, the text for an empty or blank question', () => {
      expect(
        check({ question: 'q', datasets: ['Claims'] }, ask, datasets),
      ).toEqual({
        ok: true,
        input: { question: 'q', datasets: ['Claims'], careful: false },
      });
      for (const question of ['', '  ']) {
        expect(
          check({ dataset: 'Claims', question }, readiness, datasets),
        ).toEqual({
          ok: true,
          input: {
            dataset: 'Claims',
            question: 'Assess the readiness of this dataset',
          },
        });
      }
    });

    it.each([
      [{ question: 'q' }, 'datasets', 'Select at least one dataset'],
      [
        { question: 'q', datasets: [] },
        'datasets',
        'Select at least one dataset',
      ],
      [
        { question: 'q', datasets: 'Claims' },
        'datasets',
        'Select at least one dataset',
      ],
      [
        { question: 'q', datasets: ['', ' '] },
        'datasets',
        'Select at least one dataset',
      ],
      [
        { question: 'q', datasets: ['Nope'] },
        'datasets',
        'Dataset "Nope" not found',
      ],
      [
        { question: 'q', datasets: ['Claims'], careful: 'yes' },
        'careful',
        'Careful must be true or false',
      ],
      [
        { question: 'q', datasets: ['Claims'], careful: 1 },
        'careful',
        'Careful must be true or false',
      ],
      [{ datasets: ['Claims'] }, 'question', 'Question is required'],
    ])('refuses %p on %p with %p', (input, field, message) => {
      expect(check(input, ask, datasets)).toEqual({
        ok: false,
        errors: [{ field, message }],
      });
    });

    it('refuses a blank question and no datasets together, in field order', () => {
      expect(check({ question: '   ', datasets: [] }, ask, datasets)).toEqual({
        ok: false,
        errors: [
          { field: 'question', message: 'Question is required' },
          { field: 'datasets', message: 'Select at least one dataset' },
        ],
      });
    });

    it.each([
      [{}, 'Dataset is required'],
      [{ dataset: '' }, 'Dataset is required'],
      [{ dataset: '  ' }, 'Dataset is required'],
      [{ dataset: 'Nope' }, 'Dataset "Nope" not found'],
      [
        { dataset: 'Orders API' },
        'Dataset "Orders API" is not a PostgreSQL or Databricks dataset',
      ],
      [
        { dataset: 'Unbound' },
        'Dataset "Unbound" is not a PostgreSQL or Databricks dataset',
      ],
    ])('refuses the readiness input %p with %p', (input, message) => {
      expect(check(input, readiness, datasets)).toEqual({
        ok: false,
        errors: [{ field: 'dataset', message }],
      });
    });

    it('names one, two or three kinds in the kind refusal', () => {
      const of = (kinds: ('postgres' | 'databricks' | 'rest')[]) =>
        first(
          { dataset: 'Unbound' },
          [
            {
              name: 'dataset',
              label: 'Dataset',
              type: 'dataset',
              required: true,
              datasourceKinds: kinds,
            },
          ],
          datasets,
        )?.message;
      expect(of(['postgres'])).toBe(
        'Dataset "Unbound" is not a PostgreSQL dataset',
      );
      expect(of(['postgres', 'databricks', 'rest'])).toBe(
        'Dataset "Unbound" is not a PostgreSQL, Databricks or REST dataset',
      );
    });
  });
});

describe("qti-v2-turn's input rules", () => {
  it('caps the question at 4000 characters', () => {
    const workflow = CODE_WORKFLOWS[0];
    const datasets = [{ name: 'World Cup Core', datasourceKind: 'postgres' }];
    expect(
      validateWorkflowInput(
        workflow,
        { question: 'x'.repeat(4000), datasets: ['World Cup Core'] },
        { datasets },
      ).ok,
    ).toBe(true);
    expect(
      validateWorkflowInput(
        workflow,
        { question: 'x'.repeat(4001), datasets: ['World Cup Core'] },
        { datasets },
      ),
    ).toEqual({
      ok: false,
      errors: [
        {
          field: 'question',
          message: 'Question must be at most 4000 characters',
        },
      ],
    });
  });
});
