import { CODE_WORKFLOWS } from './workflow-catalog';
import {
  IMAGE_MAX_BYTES,
  IMAGES_MAX_COUNT,
  inputFieldsWithUsage,
  validateWorkflowInput,
  withStoredImages,
  type InputWorkflowShape,
  type WorkflowInputField,
} from './workflow-input';

// That the input node covers every step (workflows R14) is now part of the
// data contract's check: workflow-contract.spec.ts (`missing`).

describe('usedBy: the steps that read a field from the input (api.md 116)', () => {
  it("Avery + Michael's question and datasets are read by Orchestrate, its one step", () => {
    expect(
      inputFieldsWithUsage(CODE_WORKFLOWS[0]).map(({ name, usedBy }) => ({
        name,
        usedBy,
      })),
    ).toEqual([
      { name: 'question', usedBy: ['orchestrate'] },
      { name: 'datasets', usedBy: ['orchestrate'] },
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

describe("answer-business-question's input rules", () => {
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

describe('an image field (agents.md 5.17)', () => {
  const workflow = {
    input: [
      {
        name: 'image',
        label: 'Dashboard image',
        type: 'image',
        required: true,
      },
    ] satisfies WorkflowInputField[],
  };
  const PNG = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('rest of the file'),
  ]);
  const url = (mediaType: string, data: Buffer) =>
    `data:${mediaType};base64,${data.toString('base64')}`;
  const refusal = (message: string) => ({
    ok: false,
    errors: [{ field: 'image', message }],
  });

  it('takes a PNG, JPEG or WebP data URL and keeps it as sent', () => {
    const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
    ]);
    for (const value of [
      url('image/png', PNG),
      url('image/jpeg', jpeg),
      url('image/webp', webp),
    ]) {
      expect(validateWorkflowInput(workflow, { image: value })).toEqual({
        ok: true,
        input: { image: value },
      });
    }
  });

  it('refuses a missing image, another type, and bytes that are not the type', () => {
    expect(validateWorkflowInput(workflow, {})).toEqual(
      refusal('Dashboard image is required'),
    );
    const wrong = refusal('Dashboard image must be a PNG, JPEG or WebP image');
    expect(
      validateWorkflowInput(workflow, { image: 'inputs/image.png' }),
    ).toEqual(wrong);
    expect(
      validateWorkflowInput(workflow, { image: url('image/gif', PNG) }),
    ).toEqual(wrong);
    expect(
      validateWorkflowInput(workflow, {
        image: url('image/png', Buffer.from('<svg onload=alert(1)>')),
      }),
    ).toEqual(wrong);
  });

  it('refuses an image over 5 MB', () => {
    const large = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]);
    expect(
      validateWorkflowInput(workflow, { image: url('image/png', large) }),
    ).toEqual(refusal('Dashboard image must be at most 5 MB'));
  });

  it('takes the image out of the input a run stores', () => {
    const value = url('image/png', PNG);
    const stored = withStoredImages(workflow, { image: value, question: 'q' });
    expect(stored.input).toEqual({ image: 'inputs/image.png', question: 'q' });
    expect(stored.images).toEqual([
      {
        field: 'image',
        path: 'inputs/image.png',
        mediaType: 'image/png',
        data: PNG,
      },
    ]);
    // An input with no image field is kept as it is.
    expect(withStoredImages({ input: [] }, { question: 'q' })).toEqual({
      input: { question: 'q' },
      images: [],
    });
  });
});

describe('one of an image or an artifact (agents.md 5.17)', () => {
  const workflow = {
    input: [
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
      { name: 'question', label: 'Question', type: 'textarea', required: true },
    ] satisfies WorkflowInputField[],
  };
  const artifacts = [
    { id: 'a-1', kind: 'dashboard' },
    { id: 'a-2', kind: 'report' },
  ];
  const image = `data:image/png;base64,${Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('file'),
  ]).toString('base64')}`;
  const check = (input: Record<string, unknown>) =>
    validateWorkflowInput(workflow, { question: 'q', ...input }, { artifacts });

  it('takes either one', () => {
    expect(check({ image })).toEqual({
      ok: true,
      input: { image, question: 'q' },
    });
    expect(check({ artifact: ' a-1 ' })).toEqual({
      ok: true,
      input: { artifact: 'a-1', question: 'q' },
    });
  });

  it('refuses neither, once, on the first of the two', () => {
    expect(check({ image: '', artifact: '  ' })).toEqual({
      ok: false,
      errors: [
        {
          field: 'image',
          message: 'Dashboard image or Saved dashboard is required',
        },
      ],
    });
    // In field order with the other fields' errors.
    expect(validateWorkflowInput(workflow, {}, { artifacts })).toEqual({
      ok: false,
      errors: [
        {
          field: 'image',
          message: 'Dashboard image or Saved dashboard is required',
        },
        { field: 'question', message: 'Question is required' },
      ],
    });
  });

  it('keeps the artifact and drops the image when both are given', () => {
    expect(check({ image, artifact: 'a-1' })).toEqual({
      ok: true,
      input: { artifact: 'a-1', question: 'q' },
    });
  });

  it('refuses an unknown artifact and one of another kind, as its own error', () => {
    expect(check({ artifact: 'gone' })).toEqual({
      ok: false,
      errors: [{ field: 'artifact', message: 'Artifact "gone" not found' }],
    });
    expect(check({ artifact: 'a-2' })).toEqual({
      ok: false,
      errors: [{ field: 'artifact', message: 'Artifact "a-2" not found' }],
    });
    // A refused image is not also "missing".
    expect(check({ image: 'inputs/image.png' })).toEqual({
      ok: false,
      errors: [
        {
          field: 'image',
          message: 'Dashboard image must be a PNG, JPEG or WebP image',
        },
      ],
    });
  });
});

describe('an images field (workflows R35)', () => {
  const workflow = {
    input: [
      { name: 'question', label: 'Question', type: 'text', required: true },
      {
        name: 'images',
        label: 'Reference images',
        type: 'images',
        required: false,
        max: IMAGES_MAX_COUNT,
      },
    ] satisfies WorkflowInputField[],
  };
  const PNG = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('rest of the file'),
  ]);
  const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
  const WEBP = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WEBPVP8 '),
  ]);
  const url = (mediaType: string, data: Buffer) =>
    `data:${mediaType};base64,${data.toString('base64')}`;
  const refusal = (message: string) => ({
    ok: false,
    errors: [{ field: 'images', message }],
  });

  it('takes up to four PNG, JPEG or WebP data URLs, in order', () => {
    const images = [
      url('image/png', PNG),
      url('image/jpeg', JPEG),
      url('image/webp', WEBP),
      url('image/png', PNG),
    ];
    expect(IMAGES_MAX_COUNT).toBe(4);
    expect(validateWorkflowInput(workflow, { question: 'q', images })).toEqual({
      ok: true,
      input: { question: 'q', images },
    });
  });

  it('leaves out a missing or empty list: the field is optional', () => {
    for (const images of [undefined, null, '', [], ['', '  ']]) {
      expect(
        validateWorkflowInput(workflow, { question: 'q', images }),
      ).toEqual({ ok: true, input: { question: 'q' } });
    }
  });

  it('refuses more than its max, another type, and bytes that are not the type', () => {
    const five = Array.from({ length: 5 }, () => url('image/png', PNG));
    expect(
      validateWorkflowInput(workflow, { question: 'q', images: five }),
    ).toEqual(refusal('Reference images must be at most 4 images'));
    const wrong = refusal('Reference images must be PNG, JPEG or WebP images');
    for (const images of [
      [url('image/png', PNG), url('image/gif', PNG)],
      ['inputs/images/1.png'],
      [url('image/png', Buffer.from('<svg onload=alert(1)>'))],
      [42],
      url('image/png', PNG),
    ]) {
      expect(
        validateWorkflowInput(workflow, { question: 'q', images }),
      ).toEqual(wrong);
    }
  });

  it('refuses an image over 5 MB', () => {
    const large = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]);
    expect(
      validateWorkflowInput(workflow, {
        question: 'q',
        images: [url('image/png', PNG), url('image/png', large)],
      }),
    ).toEqual(refusal('Reference images must be at most 5 MB each'));
  });

  it('is required when the field says so', () => {
    const required = {
      input: [{ ...workflow.input[1], required: true }],
    };
    expect(validateWorkflowInput(required, { images: [] })).toEqual(
      refusal('Reference images is required'),
    );
  });

  it('takes every image out of the input a run stores, as inputs/images/<n>.<ext>', () => {
    const stored = withStoredImages(workflow, {
      question: 'q',
      images: [url('image/png', PNG), url('image/jpeg', JPEG)],
    });
    expect(stored.input).toEqual({
      question: 'q',
      images: ['inputs/images/1.png', 'inputs/images/2.jpg'],
    });
    expect(stored.images).toEqual([
      {
        field: 'images',
        path: 'inputs/images/1.png',
        mediaType: 'image/png',
        data: PNG,
      },
      {
        field: 'images',
        path: 'inputs/images/2.jpg',
        mediaType: 'image/jpeg',
        data: JPEG,
      },
    ]);
  });

  it('keeps the image field and the images field apart', () => {
    const both = {
      input: [
        { name: 'image', label: 'Image', type: 'image', required: false },
        ...workflow.input,
      ] satisfies WorkflowInputField[],
    };
    const stored = withStoredImages(both, {
      image: url('image/webp', WEBP),
      images: [url('image/png', PNG)],
    });
    expect(stored.input).toEqual({
      image: 'inputs/image.webp',
      images: ['inputs/images/1.png'],
    });
    expect(stored.images.map((image) => image.path)).toEqual([
      'inputs/image.webp',
      'inputs/images/1.png',
    ]);
  });
});
