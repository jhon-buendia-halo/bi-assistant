import { WorkflowInputField } from '../models/workflow.model';
import {
  IMAGE_MAX_BYTES,
  fieldRulesLabel,
  inputErrorsByField,
  isImageDataUrl,
  usedByTitles,
  validateRunForm,
} from './workflow-input-validation';

const question: WorkflowInputField = {
  name: 'question',
  label: 'Question',
  type: 'textarea',
  required: true,
  maxLength: 10,
};
const datasets: WorkflowInputField = {
  name: 'datasets',
  label: 'Datasets',
  type: 'datasets',
  required: true,
  datasourceKinds: ['postgres', 'databricks'],
};
const limit: WorkflowInputField = {
  name: 'limit',
  label: 'Row limit',
  type: 'number',
  required: false,
  min: 1,
  max: 100,
};
const store = [
  { name: 'Sales', datasourceKind: 'postgres' as const },
  { name: 'Weather', datasourceKind: 'rest' as const },
];

describe('validateRunForm (the run form checks its input before Execute)', () => {
  it('collects every error in field order: whitespace question and no dataset', () => {
    expect(
      validateRunForm([question, datasets], { question: '   ' }, store),
    ).toEqual([
      { field: 'question', message: 'Question is required' },
      { field: 'datasets', message: 'Select at least one dataset' },
    ]);
  });

  it('accepts a valid form', () => {
    expect(
      validateRunForm(
        [question, datasets, limit],
        { question: 'Top sales', datasets: ['Sales'], limit: '10' },
        store,
      ),
    ).toEqual([]);
  });

  it('refuses a text longer than maxLength (trimmed)', () => {
    expect(
      validateRunForm([question], { question: '  12345678901  ' }, store),
    ).toEqual([
      { field: 'question', message: 'Question must be at most 10 characters' },
    ]);
    expect(
      validateRunForm([question], { question: ' 1234567890 ' }, store),
    ).toEqual([]);
  });

  it('checks a number: type, min and max; an empty optional number passes', () => {
    expect(validateRunForm([limit], { limit: 'abc' }, store)).toEqual([
      { field: 'limit', message: 'Row limit must be a number' },
    ]);
    expect(validateRunForm([limit], { limit: '0' }, store)).toEqual([
      { field: 'limit', message: 'Row limit must be at least 1' },
    ]);
    expect(validateRunForm([limit], { limit: '101' }, store)).toEqual([
      { field: 'limit', message: 'Row limit must be at most 100' },
    ]);
    expect(validateRunForm([limit], { limit: ' ' }, store)).toEqual([]);
  });

  it('checks a dataset exists and is of the field kinds, when the list is known', () => {
    expect(validateRunForm([datasets], { datasets: ['Gone'] }, store)).toEqual([
      { field: 'datasets', message: 'Dataset "Gone" not found' },
    ]);
    expect(
      validateRunForm([datasets], { datasets: ['Weather'] }, store),
    ).toEqual([
      {
        field: 'datasets',
        message: 'Dataset "Weather" is not a PostgreSQL or Databricks dataset',
      },
    ]);
    expect(validateRunForm([datasets], { datasets: ['Gone'] }, null)).toEqual(
      [],
    );
  });

  it('a required field with a default, a hidden field and a boolean never fail', () => {
    const withDefault: WorkflowInputField = { ...question, default: 'Hi' };
    const hidden: WorkflowInputField = { ...question, name: 'h', hidden: true };
    const flag: WorkflowInputField = {
      name: 'flag',
      label: 'Flag',
      type: 'boolean',
      required: true,
    };
    expect(validateRunForm([withDefault, hidden, flag], {}, store)).toEqual([]);
  });
});

describe('validateRunForm, a single dataset field', () => {
  const dataset: WorkflowInputField = {
    name: 'dataset',
    label: 'Dataset',
    type: 'dataset',
    required: true,
    datasourceKinds: ['postgres', 'databricks'],
  };

  it('requires a pick: "<Label> is required"', () => {
    expect(validateRunForm([dataset], {}, store)).toEqual([
      { field: 'dataset', message: 'Dataset is required' },
    ]);
  });

  it('checks the pick exists and is of the field kinds', () => {
    expect(validateRunForm([dataset], { dataset: 'Sales' }, store)).toEqual([]);
    expect(validateRunForm([dataset], { dataset: 'Gone' }, store)).toEqual([
      { field: 'dataset', message: 'Dataset "Gone" not found' },
    ]);
    expect(validateRunForm([dataset], { dataset: 'Weather' }, store)).toEqual([
      {
        field: 'dataset',
        message: 'Dataset "Weather" is not a PostgreSQL or Databricks dataset',
      },
    ]);
  });

  it('does not check existence while the datasets list is unknown', () => {
    expect(validateRunForm([dataset], { dataset: 'Gone' }, null)).toEqual([]);
  });
});

describe('inputErrorsByField', () => {
  it('keeps the first message per field and leaves out non-field errors', () => {
    expect(
      inputErrorsByField([
        { field: 'question', message: 'A' },
        { field: 'question', message: 'B' },
        { field: null, message: 'C' },
      ]),
    ).toEqual({ question: 'A' });
  });
});

describe('the Start dialog Parameters rows', () => {
  it('describes a field rules', () => {
    expect(fieldRulesLabel(question)).toBe('Max 10 characters');
    expect(fieldRulesLabel(limit)).toBe('Min 1 · Max 100');
    expect(fieldRulesLabel(datasets)).toBe('PostgreSQL or Databricks datasets');
    expect(fieldRulesLabel({ ...limit, min: undefined, max: undefined })).toBe(
      '',
    );
  });

  it('names the steps that read a field by their titles', () => {
    const steps = [
      { id: 'receive-question', title: 'Receive question' },
      { id: 'answer', title: 'Answer' },
    ];
    expect(
      usedByTitles(
        { ...question, usedBy: ['receive-question', 'gone'] },
        steps,
      ),
    ).toEqual(['Receive question', 'gone']);
    expect(usedByTitles(question, steps)).toEqual([]);
  });
});

describe('an image field', () => {
  const image: WorkflowInputField = {
    name: 'image',
    label: 'Dashboard image',
    type: 'image',
    required: true,
  };
  const errorOf = (value: string | undefined) =>
    validateRunForm([image], value === undefined ? {} : { image: value }, null);

  it('takes a PNG, JPEG or WebP data URL', () => {
    for (const type of ['png', 'jpeg', 'webp']) {
      expect(errorOf(`data:image/${type};base64,AAAA`)).toEqual([]);
    }
    expect(isImageDataUrl('data:image/png;base64,AAAA')).toBeTrue();
  });

  it('refuses a missing image, another file type and a stored path', () => {
    expect(errorOf(undefined)).toEqual([
      { field: 'image', message: 'Dashboard image is required' },
    ]);
    const wrong = [
      {
        field: 'image',
        message: 'Dashboard image must be a PNG, JPEG or WebP image',
      },
    ];
    expect(errorOf('data:image/gif;base64,AAAA')).toEqual(wrong);
    expect(errorOf('data:application/pdf;base64,AAAA')).toEqual(wrong);
    expect(errorOf('inputs/image.png')).toEqual(wrong);
    expect(isImageDataUrl('inputs/image.png')).toBeFalse();
  });

  it('refuses an image over 5 MB and takes one of exactly 5 MB', () => {
    // Four base64 characters hold three bytes.
    const base64 = (bytes: number) => 'A'.repeat((bytes / 3) * 4);
    expect(errorOf(`data:image/png;base64,${base64(IMAGE_MAX_BYTES)}`)).toEqual(
      [],
    );
    expect(
      errorOf(`data:image/png;base64,${base64(IMAGE_MAX_BYTES + 3)}`),
    ).toEqual([
      { field: 'image', message: 'Dashboard image must be at most 5 MB' },
    ]);
  });
});

describe('requiredWithout (an image or a saved artifact)', () => {
  const image: WorkflowInputField = {
    name: 'image',
    label: 'Dashboard image',
    type: 'image',
    required: false,
    requiredWithout: 'artifact',
  };
  const artifact: WorkflowInputField = {
    name: 'artifact',
    label: 'Saved dashboard',
    type: 'artifact',
    required: false,
    requiredWithout: 'image',
    artifactKinds: ['dashboard'],
  };
  const png = 'data:image/png;base64,AAAA';

  it('refuses neither, once, on the first field of the pair', () => {
    expect(validateRunForm([image, artifact], {}, null)).toEqual([
      {
        field: 'image',
        message: 'Dashboard image or Saved dashboard is required',
      },
    ]);
    expect(
      validateRunForm([image, artifact], { image: '', artifact: ' ' }, null),
    ).toHaveSize(1);
  });

  it('accepts only an image', () => {
    expect(validateRunForm([image, artifact], { image: png }, null)).toEqual(
      [],
    );
  });

  it('accepts only an artifact, without checking it', () => {
    expect(
      validateRunForm([image, artifact], { artifact: 'a-1' }, null),
    ).toEqual([]);
  });
});

describe('an images field', () => {
  const images: WorkflowInputField = {
    name: 'images',
    label: 'Reference images',
    type: 'images',
    required: false,
    max: 4,
  };
  const png = 'data:image/png;base64,AAAA';
  const errorOf = (value?: string[]) =>
    validateRunForm(
      [images],
      value === undefined ? {} : { images: value },
      null,
    );

  it('takes no images, and up to 4 of the allowed types', () => {
    expect(errorOf()).toEqual([]);
    expect(errorOf([])).toEqual([]);
    expect(errorOf([png, png, png, png])).toEqual([]);
    expect(
      errorOf(['data:image/jpeg;base64,AAAA', 'data:image/webp;base64,AAAA']),
    ).toEqual([]);
  });

  it('takes the stored paths a follow-up keeps beside new images', () => {
    expect(errorOf(['inputs/images/1.png', png])).toEqual([]);
  });

  it('refuses another type, an image over 5 MB and a fifth image', () => {
    expect(errorOf(['data:image/gif;base64,AAAA'])).toEqual([
      {
        field: 'images',
        message: 'Reference images must be PNG, JPEG or WebP images',
      },
    ]);
    const base64 = (bytes: number) => 'A'.repeat((bytes / 3) * 4);
    expect(
      errorOf([`data:image/png;base64,${base64(IMAGE_MAX_BYTES)}`]),
    ).toEqual([]);
    expect(
      errorOf([`data:image/png;base64,${base64(IMAGE_MAX_BYTES + 3)}`]),
    ).toEqual([
      {
        field: 'images',
        message: 'Reference images must be at most 5 MB each',
      },
    ]);
    expect(errorOf([png, png, png, png, png])).toEqual([
      { field: 'images', message: 'Reference images must be at most 4 images' },
    ]);
  });

  it('is required only when the field says so', () => {
    expect(validateRunForm([{ ...images, required: true }], {}, null)).toEqual([
      { field: 'images', message: 'Reference images is required' },
    ]);
  });
});
