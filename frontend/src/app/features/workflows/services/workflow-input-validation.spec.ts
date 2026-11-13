import { WorkflowInputField } from '../models/workflow.model';
import {
  fieldRulesLabel,
  inputErrorsByField,
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
    expect(validateRunForm([question], { question: ' 1234567890 ' }, store)).toEqual([]);
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
    expect(
      validateRunForm([datasets], { datasets: ['Gone'] }, store),
    ).toEqual([{ field: 'datasets', message: 'Dataset "Gone" not found' }]);
    expect(
      validateRunForm([datasets], { datasets: ['Weather'] }, store),
    ).toEqual([
      {
        field: 'datasets',
        message: 'Dataset "Weather" is not a PostgreSQL or Databricks dataset',
      },
    ]);
    expect(validateRunForm([datasets], { datasets: ['Gone'] }, null)).toEqual([]);
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
      usedByTitles({ ...question, usedBy: ['receive-question', 'gone'] }, steps),
    ).toEqual(['Receive question', 'gone']);
    expect(usedByTitles(question, steps)).toEqual([]);
  });
});
