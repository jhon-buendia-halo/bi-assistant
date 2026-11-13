/**
 * A workflow's input node (the Start node; api.md 116-119; workflows R14):
 * the typed fields a run takes, which steps read each field, and the check
 * of a run's whole input before anything runs. Plain data and pure
 * functions, no framework import, so the catalogue, the services and Jest
 * can read it. That the fields give every step what it reads, with the
 * right types, is the data contract's check (./workflow-contract.ts).
 */

/** The type of one input field (plan 4.1). */
export type WorkflowInputFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  /** A checkbox; absent means false (or the field's default). */
  | 'boolean'
  /** One or more dataset names. */
  | 'datasets'
  /** Exactly one dataset name. */
  | 'dataset';

/** The datasource kinds a `dataset` or `datasets` field can be limited to. */
export type InputDatasourceKind = 'postgres' | 'databricks' | 'rest';

/** One field of a workflow's input, defined in code (api.md 116). */
export interface WorkflowInputField {
  name: string;
  label: string;
  type: WorkflowInputFieldType;
  required: boolean;
  placeholder?: string;
  /** One line under the control. */
  help?: string;
  /** The value of a field that is missing or empty. */
  default?: string | number | boolean;
  /** `dataset` / `datasets`: only datasets bound to these kinds. */
  datasourceKinds?: InputDatasourceKind[];
  /** Set by the app, never rendered as a control. */
  hidden?: boolean;
  /** `text` / `textarea`: the most characters of the trimmed text. */
  maxLength?: number;
  /** `number`: the smallest value. */
  min?: number;
  /** `number`: the largest value. */
  max?: number;
}

/** A field as 116 and 117 send it: with the steps that read it. */
export interface WorkflowInputFieldDetail extends WorkflowInputField {
  /**
   * The ids of the steps that read the field straight from the workflow's
   * input (no earlier step outputs that name), in step order.
   */
  usedBy: string[];
}

/** What `usedBy` needs of a step: its id and its field names. */
export interface InputStepShape {
  id: string;
  input: readonly string[];
  output: readonly string[];
}

/** What `usedBy` needs of a workflow: its fields and its steps. */
export interface InputWorkflowShape {
  id?: string;
  input: readonly WorkflowInputField[];
  steps: readonly InputStepShape[];
}

/**
 * The workflow's fields with `usedBy`: per field, the ids of the steps whose
 * input names it while no earlier step has output that name, in step order.
 * Copies, so the caller can change them safely.
 */
export function inputFieldsWithUsage(
  workflow: InputWorkflowShape,
): WorkflowInputFieldDetail[] {
  const readers = new Map<string, string[]>(
    workflow.input.map((field) => [field.name, []]),
  );
  const shadowed = new Set<string>();
  for (const step of workflow.steps) {
    for (const name of step.input) {
      if (!shadowed.has(name)) readers.get(name)?.push(step.id);
    }
    for (const name of step.output) shadowed.add(name);
  }
  return workflow.input.map((field) => ({
    ...field,
    ...(field.datasourceKinds
      ? { datasourceKinds: [...field.datasourceKinds] }
      : {}),
    usedBy: [...(readers.get(field.name) ?? [])],
  }));
}

/** One value of a run's input. */
export type WorkflowInputValue = string | number | boolean | string[];

/** A run's input values, by field name. */
export type WorkflowInputValues = Record<string, WorkflowInputValue>;

/** A dataset a `dataset` or `datasets` field is checked against. */
export interface InputDataset {
  name: string;
  datasourceKind?: string;
}

/** One refusal of a run's input: the field it is about, or null. */
export interface WorkflowInputError {
  field: string | null;
  message: string;
}

/** What the input check reads besides the input: the stored datasets. */
export interface WorkflowInputContext {
  datasets?: readonly InputDataset[];
}

export type WorkflowInputValidation =
  | { ok: true; input: WorkflowInputValues }
  | { ok: false; errors: WorkflowInputError[] };

/** How a refusal names a datasource kind. */
const KIND_LABELS: Record<InputDatasourceKind, string> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks',
  rest: 'REST',
};

/** `A`, `A or B`, `A, B or C`. */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

type FieldCheck =
  { ok: true; value?: WorkflowInputValue } | { ok: false; error: string };

/** One dataset name checked against the store and the field's kinds. */
function datasetError(
  field: WorkflowInputField,
  name: string,
  datasets: readonly InputDataset[],
): string | undefined {
  const found = datasets.find((dataset) => dataset.name === name);
  if (!found) return `Dataset "${name}" not found`;
  const kinds = field.datasourceKinds;
  if (
    kinds?.length &&
    !kinds.includes(found.datasourceKind as InputDatasourceKind)
  ) {
    return `Dataset "${name}" is not a ${orList(kinds.map((kind) => KIND_LABELS[kind]))} dataset`;
  }
  return undefined;
}

/** A field that is missing or empty: its default, a refusal, or nothing. */
function missingField(field: WorkflowInputField): FieldCheck {
  if (field.default !== undefined) return { ok: true, value: field.default };
  if (field.type === 'boolean') return { ok: true, value: false };
  if (!field.required) return { ok: true };
  return {
    ok: false,
    error:
      field.type === 'datasets'
        ? 'Select at least one dataset'
        : `${field.label} is required`,
  };
}

/** A number checked against the field's `min` and `max`. */
function numberCheck(field: WorkflowInputField, value: number): FieldCheck {
  if (field.min !== undefined && value < field.min) {
    return { ok: false, error: `${field.label} must be at least ${field.min}` };
  }
  if (field.max !== undefined && value > field.max) {
    return { ok: false, error: `${field.label} must be at most ${field.max}` };
  }
  return { ok: true, value };
}

/** One field's value checked against its type and rules (plan 4.1). */
function checkField(
  field: WorkflowInputField,
  value: unknown,
  datasets: readonly InputDataset[],
): FieldCheck {
  if (field.type === 'boolean') {
    if (value === undefined || value === null || value === '') {
      return missingField(field);
    }
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, error: `${field.label} must be true or false` };
  }
  if (field.type === 'datasets') {
    const names = Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((name): name is string => typeof name === 'string')
              .map((name) => name.trim())
              .filter(Boolean),
          ),
        ]
      : [];
    if (!names.length) return missingField(field);
    for (const name of names) {
      const error = datasetError(field, name, datasets);
      if (error) return { ok: false, error };
    }
    return { ok: true, value: names };
  }
  const usable =
    (typeof value === 'string' && value.trim() !== '') ||
    typeof value === 'number';
  if (!usable) return missingField(field);
  if (field.type === 'number') {
    const typed = typeof value === 'string' ? value.trim() : '';
    const number =
      typeof value === 'number' ? value : typed ? Number(typed) : NaN;
    return Number.isFinite(number)
      ? numberCheck(field, number)
      : { ok: false, error: `${field.label} must be a number` };
  }
  if (field.type === 'dataset') {
    const name = String(value).trim();
    const error = datasetError(field, name, datasets);
    return error ? { ok: false, error } : { ok: true, value: name };
  }
  const text = String(value);
  if (field.maxLength !== undefined && text.trim().length > field.maxLength) {
    return {
      ok: false,
      error: `${field.label} must be at most ${field.maxLength} characters`,
    };
  }
  return { ok: true, value: text };
}

/**
 * A run's whole input checked against the workflow's fields before the run
 * (api.md 118, 119; workflows R14), every refusal collected in field order,
 * at most one per field: the declared fields only, a number field as a
 * number within its `min` and `max`, a boolean as a boolean, a text within
 * its `maxLength` (trimmed), datasets as trimmed names in order without
 * repeats. A field that is missing, `""` or whitespace-only takes its
 * `default` (a boolean `false`); a required one without a default is refused
 * with `<label> is required` (`Select at least one dataset` for `datasets`).
 * An optional field that is missing or empty and has no default is left
 * out. A text value is kept as sent.
 */
export function validateWorkflowInput(
  workflow: { input: readonly WorkflowInputField[] },
  raw: unknown,
  ctx: WorkflowInputContext = {},
): WorkflowInputValidation {
  const body =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const input: WorkflowInputValues = {};
  const errors: WorkflowInputError[] = [];
  for (const field of workflow.input) {
    const value = Object.hasOwn(body, field.name)
      ? body[field.name]
      : undefined;
    const checked = checkField(field, value, ctx.datasets ?? []);
    if (!checked.ok) {
      errors.push({ field: field.name, message: checked.error });
    } else if (checked.value !== undefined) {
      input[field.name] = checked.value;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, input };
}
