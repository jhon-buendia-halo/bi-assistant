import { JsonSchema, WorkflowRunStepStatus } from '../models/workflow.model';

/**
 * Pure helpers for the steps' declared data contracts (ui.md 4.4b): a JSON
 * Schema as display fields, the edges' `Passes on:` text, and the
 * `Contract violation …` step errors (api.md 3.6).
 */

/** One field of a declared contract, as the page shows it. */
export interface ContractField {
  name: string;
  /** `string`, `number`, `boolean`, `object`, `string[]`, `object[]`, `string | null`, …; null when no schema is declared. */
  type: string | null;
  required: boolean;
  description: string | null;
  /** An object's (or an object array's items') properties. */
  children: ContractField[];
}

/** A contract field flattened for a list, with its nesting depth. */
export interface ContractFieldRow extends ContractField {
  depth: number;
}

/** Which side of a step its declared contract was broken on. */
export type ContractSide = 'input' | 'output';

/** A step error that starts with `Contract violation`, split for display. */
export interface ContractViolation {
  stepTitle: string;
  side: ContractSide;
  /** `Contract violation in <title>[ (input)]: `. */
  prefix: string;
  /** Dotted, e.g. `calls[2].rowCount`. */
  path: string;
  message: string;
}

function baseType(type: string): string {
  return type === 'integer' ? 'number' : type;
}

/** A schema's type as one label: `string`, `number`, `string[]`, `object[]`, `string | null`, `unknown`. */
export function schemaTypeLabel(schema: JsonSchema | null | undefined): string {
  if (!schema) return 'unknown';
  const union = schema.anyOf ?? schema.oneOf;
  if (union?.length) {
    return [...new Set(union.map(schemaTypeLabel))].join(' | ');
  }
  const { type } = schema;
  if (Array.isArray(type)) {
    return [
      ...new Set(
        type.map((t) =>
          t === 'array' ? schemaTypeLabel({ type: 'array', items: schema.items }) : baseType(t),
        ),
      ),
    ].join(' | ');
  }
  if (type === 'array') {
    return `${schema.items ? schemaTypeLabel(schema.items) : 'unknown'}[]`;
  }
  if (typeof type === 'string') return baseType(type);
  if (schema.properties) return 'object';
  if (schema.enum?.length) {
    const kinds = [...new Set(schema.enum.map((v) => typeof v))];
    return kinds.length === 1 ? baseType(kinds[0]) : 'unknown';
  }
  return 'unknown';
}

/** The object whose properties nest under a field: itself, or its array items. */
function nestedObject(schema: JsonSchema): JsonSchema | null {
  if (schema.properties) return schema;
  if (schema.items?.properties) return schema.items;
  return null;
}

function fieldsOf(schema: JsonSchema): ContractField[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const nested = nestedObject(property);
    return {
      name,
      type: schemaTypeLabel(property),
      required: required.has(name),
      description: property.description ?? null,
      children: nested ? fieldsOf(nested) : [],
    };
  });
}

/**
 * A declared contract's top-level fields in schema order; without a schema
 * (an older backend), the step's field names, untyped.
 */
export function contractFields(
  schema: JsonSchema | null | undefined,
  names: readonly string[] = [],
): ContractField[] {
  if (schema?.properties) return fieldsOf(schema);
  return names.map((name) => ({
    name,
    type: null,
    required: false,
    description: null,
    children: [],
  }));
}

/** The fields and their nested fields, depth first. */
export function flattenContractFields(
  fields: ContractField[],
  depth = 0,
): ContractFieldRow[] {
  return fields.flatMap((field) => [
    { ...field, depth },
    ...flattenContractFields(field.children, depth + 1),
  ]);
}

/** An edge's text: `Passes on: question (string), datasets (string[])`. */
export function passesOnText(fields: ContractField[]): string {
  const parts = fields.map((f) =>
    f.type === null ? f.name : `${f.name} (${f.type})`,
  );
  return `Passes on: ${parts.join(', ')}`;
}

const VIOLATION = /^(Contract violation in (.+?)( \(input\))?: )(\S+)(?: ([\s\S]*))?$/;

/** A `Contract violation in <title>[ (input)]: <path> <message>` error, split; null for any other error. */
export function parseContractViolation(
  error: string | null | undefined,
): ContractViolation | null {
  const match = error ? VIOLATION.exec(error) : null;
  if (!match) return null;
  return {
    stepTitle: match[2],
    side: match[3] ? 'input' : 'output',
    prefix: match[1],
    path: match[4],
    message: match[5] ?? '',
  };
}

/** Each failed step whose error is a contract violation, by step id, with the side it broke on. */
export function contractViolationSides(
  steps:
    | readonly {
        id: string;
        status: WorkflowRunStepStatus | null;
        error?: string;
      }[]
    | null
    | undefined,
): Record<string, ContractSide> {
  const sides: Record<string, ContractSide> = {};
  for (const step of steps ?? []) {
    if (step.status !== 'failed') continue;
    const violation = parseContractViolation(step.error);
    if (violation) sides[step.id] = violation.side;
  }
  return sides;
}
