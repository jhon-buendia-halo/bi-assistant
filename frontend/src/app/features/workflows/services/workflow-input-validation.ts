import {
  WorkflowInputError,
  WorkflowInputField,
} from '../models/workflow.model';
import { RunFormValues } from './workflows.util';

/** A dataset as the run form knows it. */
export interface RunFormDataset {
  name: string;
  datasourceKind?: string;
}

type DatasourceKind = NonNullable<WorkflowInputField['datasourceKinds']>[number];

/** How a message names a datasource kind (as the backend does). */
const KIND_LABELS: Record<DatasourceKind, string> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks',
  rest: 'REST',
};

/** `A`, `A or B`, `A, B or C`. */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

/** A missing, empty or whitespace-only value: refused only when required without a default. */
function missing(field: WorkflowInputField): string | null {
  if (!field.required || field.default !== undefined) return null;
  return field.type === 'datasets'
    ? 'Select at least one dataset'
    : `${field.label} is required`;
}

function datasetError(
  field: WorkflowInputField,
  name: string,
  datasets: readonly RunFormDataset[],
): string | null {
  const found = datasets.find((dataset) => dataset.name === name);
  if (!found) return `Dataset "${name}" not found`;
  const kinds = field.datasourceKinds;
  if (
    kinds?.length &&
    !kinds.includes(found.datasourceKind as DatasourceKind)
  ) {
    return `Dataset "${name}" is not a ${orList(kinds.map((kind) => KIND_LABELS[kind]))} dataset`;
  }
  return null;
}

function fieldError(
  field: WorkflowInputField,
  value: RunFormValues[string] | undefined,
  datasets: readonly RunFormDataset[] | null,
): string | null {
  if (field.type === 'boolean') return null;
  if (field.type === 'datasets') {
    const names = Array.isArray(value)
      ? [...new Set(value.map((name) => name.trim()).filter(Boolean))]
      : [];
    if (names.length === 0) return missing(field);
    if (datasets === null) return null;
    for (const name of names) {
      const error = datasetError(field, name, datasets);
      if (error) return error;
    }
    return null;
  }
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number'
        ? String(value)
        : '';
  if (!text) return missing(field);
  if (field.type === 'number') {
    const number = Number(text);
    if (!Number.isFinite(number)) return `${field.label} must be a number`;
    if (field.min !== undefined && number < field.min) {
      return `${field.label} must be at least ${field.min}`;
    }
    if (field.max !== undefined && number > field.max) {
      return `${field.label} must be at most ${field.max}`;
    }
    return null;
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return `${field.label} must be at most ${field.maxLength} characters`;
  }
  return null;
}

/**
 * The run form's input checked before Execute sends it, with the backend's
 * rules and messages (api.md 118, 119; ui.md 4.4b): every error of the
 * visible fields, in field order. A required field that is missing, empty
 * or whitespace-only and has no default is `<label> is required`
 * (`Select at least one dataset`); then `maxLength`, number type, `min` and
 * `max`, and, when `datasets` is the known list (null while it is not), each
 * picked dataset's existence and kind. A pure function.
 */
export function validateRunForm(
  fields: readonly WorkflowInputField[],
  values: RunFormValues,
  datasets: readonly RunFormDataset[] | null,
): WorkflowInputError[] {
  const errors: WorkflowInputError[] = [];
  for (const field of fields) {
    if (field.hidden) continue;
    const value = Object.hasOwn(values, field.name)
      ? values[field.name]
      : undefined;
    const message = fieldError(field, value, datasets);
    if (message !== null) errors.push({ field: field.name, message });
  }
  return errors;
}

/** The first message of each field; errors not about a field are left out. */
export function inputErrorsByField(
  errors: readonly WorkflowInputError[],
): Record<string, string> {
  const byField: Record<string, string> = {};
  for (const error of errors) {
    if (error.field !== null && !Object.hasOwn(byField, error.field)) {
      byField[error.field] = error.message;
    }
  }
  return byField;
}

/**
 * A field's rules as the Start dialog lists them: `Max <n> characters`,
 * `Min <n> · Max <n>`, `<kinds> datasets`; '' when it has none.
 */
export function fieldRulesLabel(field: WorkflowInputField): string {
  const rules: string[] = [];
  if (field.maxLength !== undefined) {
    rules.push(`Max ${field.maxLength} characters`);
  }
  if (field.min !== undefined) rules.push(`Min ${field.min}`);
  if (field.max !== undefined) rules.push(`Max ${field.max}`);
  if (field.datasourceKinds?.length) {
    rules.push(
      `${orList(field.datasourceKinds.map((kind) => KIND_LABELS[kind]))} datasets`,
    );
  }
  return rules.join(' · ');
}

/** The titles of the steps that read a field (its id when no step has it). */
export function usedByTitles(
  field: Pick<WorkflowInputField, 'usedBy'>,
  steps: readonly { id: string; title: string }[],
): string[] {
  return (field.usedBy ?? []).map(
    (id) => steps.find((step) => step.id === id)?.title ?? id,
  );
}
