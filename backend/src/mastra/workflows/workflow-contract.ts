/**
 * The data contract between a workflow's nodes (agents.md 5.12; workflows
 * R26): each step's declared input and output schema as JSON Schema, the
 * field names derived from them, the workflow's `contractHash`, the check
 * the catalogue runs when it loads (every step input given, with a
 * compatible type), and the run-time guard that validates a step's input
 * before it runs and its output after. Zod and Node only, no framework
 * import, so the catalogue and Jest can load it without Mastra.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import type {
  WorkflowInputField,
  WorkflowInputFieldType,
} from './workflow-input';

/** A JSON Schema as `z.toJSONSchema` writes it (draft 2020-12, no `$schema`). */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  [keyword: string]: unknown;
}

/**
 * A Zod schema's JSON Schema: its input side (what the step accepts) or its
 * output side (what it passes on), without the `$schema` keyword.
 */
export function contractJsonSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
): JsonSchema {
  const converted = z.toJSONSchema(schema, { io }) as JsonSchema;
  delete converted['$schema'];
  return converted;
}

/** An object schema's top-level property names, in schema order. */
export function schemaFieldNames(schema: JsonSchema): string[] {
  return Object.keys(schema.properties ?? {});
}

/** One step as the contract sees it: its id and its two schemas. */
export interface ContractStep {
  id: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/**
 * One edge of a workflow's graph (api.md 117): `from` and `to` are step ids,
 * `start` or `end`. `next` is the plain flow, `branch` one of the paths a
 * condition picks, `loop` a way back to an earlier step.
 */
export interface WorkflowEdge {
  from: string;
  to: string;
  kind: 'next' | 'branch' | 'loop';
  label?: string;
}

/**
 * One workflow as the contract sees it: its input fields, its steps and,
 * when its flow is not the steps' order, its edges.
 */
export interface ContractWorkflow {
  id?: string;
  input: readonly WorkflowInputField[];
  steps: readonly ContractStep[];
  edges?: readonly WorkflowEdge[];
}

/** Sorted keys, recursively, so equal contracts serialize equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/**
 * The workflow's contract hash (api.md 117): the first 12 hex characters of
 * the sha256 of the canonical JSON (keys sorted) of `{ input, steps }`,
 * where `input` is each input field's `name`, `type` and `required`, and
 * `steps` each step's `id`, `inputSchema` and `outputSchema`, in order;
 * a workflow with edges adds `edges`, each edge's `from`, `to` and `kind`,
 * in order. Labels, help texts and the workflow's id are not the contract.
 */
export function contractHash(workflow: ContractWorkflow): string {
  const contract = {
    input: workflow.input.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
    })),
    steps: workflow.steps.map((step) => ({
      id: step.id,
      inputSchema: step.inputSchema,
      outputSchema: step.outputSchema,
    })),
    ...(workflow.edges
      ? {
          edges: workflow.edges.map(({ from, to, kind }) => ({
            from,
            to,
            kind,
          })),
        }
      : {}),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(contract)))
    .digest('hex')
    .slice(0, 12);
}

/** How a step input breaks the contract. */
export type ContractProblemKind = 'missing' | 'type' | 'optional';

/** One broken step input: the step, the field's path and why. */
export interface ContractProblem {
  stepId: string;
  /** The field's path: `count`, `tags[]`, `rows[].n`, `item.id`. */
  field: string;
  problem: ContractProblemKind;
  /** `not given by the input or an earlier step`, `expected <a>, got <b>` or `may be missing`. */
  message: string;
}

/** The JSON Schema an input field's values have (plan 4.1). */
const FIELD_SCHEMAS: Record<WorkflowInputFieldType, JsonSchema> = {
  text: { type: 'string' },
  textarea: { type: 'string' },
  dataset: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  datasets: { type: 'array', items: { type: 'string' } },
};

/** A schema's JSON types, or undefined when it accepts anything. */
function typesOf(schema: JsonSchema | undefined): string[] | undefined {
  if (!schema) return undefined;
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return [...schema.type];
  const members = schema.anyOf ?? schema.oneOf;
  if (!members) return undefined;
  const types: string[] = [];
  for (const member of members) {
    const inner = typesOf(member);
    if (!inner) return undefined;
    types.push(...inner.filter((type) => !types.includes(type)));
  }
  return types;
}

/** The member of a union with the given JSON type (the schema itself otherwise). */
function memberOf(schema: JsonSchema, type: string): JsonSchema {
  const members = schema.anyOf ?? schema.oneOf;
  return members?.find((member) => typesOf(member)?.includes(type)) ?? schema;
}

/** How a type reads in a problem: `string`, `string[]`, `string | null`. */
function typeLabel(schema: JsonSchema | undefined): string {
  const types = typesOf(schema);
  if (!types) return 'unknown';
  return types
    .map((type) =>
      type === 'array' && schema
        ? `${typeLabel(memberOf(schema, 'array').items)}[]`
        : type,
    )
    .join(' | ');
}

/** Whether one JSON type is accepted where another is expected. */
function accepts(expected: string[], got: string): boolean {
  return (
    expected.includes(got) || (got === 'integer' && expected.includes('number'))
  );
}

/**
 * The problems of one value given where another is expected: a different
 * JSON type, then, for arrays, the items, and for objects, every property
 * the expected object requires (given, required, compatible).
 */
function compare(
  expected: JsonSchema | undefined,
  got: JsonSchema | undefined,
  path: string,
  push: (field: string, problem: ContractProblemKind, message: string) => void,
): void {
  const want = typesOf(expected);
  if (!want || !expected) return;
  const have = typesOf(got);
  if (!have || !got || !have.every((type) => accepts(want, type))) {
    push(
      path,
      'type',
      `expected ${typeLabel(expected)}, got ${typeLabel(got)}`,
    );
    return;
  }
  if (have.includes('array')) {
    compare(
      memberOf(expected, 'array').items,
      memberOf(got, 'array').items,
      `${path}[]`,
      push,
    );
  }
  if (have.includes('object')) {
    compareObjects(
      memberOf(expected, 'object'),
      memberOf(got, 'object'),
      path,
      push,
    );
  }
}

/** Every required property of `expected`, given by `got`, required and compatible. */
function compareObjects(
  expected: JsonSchema,
  got: JsonSchema,
  path: string,
  push: (field: string, problem: ContractProblemKind, message: string) => void,
): void {
  for (const name of expected.required ?? []) {
    const field = path ? `${path}.${name}` : name;
    const given = got.properties?.[name];
    if (!given) {
      push(field, 'missing', 'not given by the earlier step');
      continue;
    }
    if (!(got.required ?? []).includes(name)) {
      push(field, 'optional', 'may be missing');
      continue;
    }
    compare(expected.properties?.[name], given, field, push);
  }
}

/** What gives a step input: an earlier output's property, or an input field. */
interface Provider {
  schema: JsonSchema;
  /** Always present: required, or an input field with a value either way. */
  sure: boolean;
}

/** The node every path starts at, and the one it ends at. */
const START = 'start';

/**
 * The steps on every path from Start to each step (its dominators, the step
 * itself left out), closest first, following the `next` and `branch` edges
 * (a `loop` edge goes back to a step already on the path, so it adds no
 * step that every path has). A step no path reaches has none.
 */
export function stepsOnEveryPath(
  steps: readonly { id: string }[],
  edges: readonly WorkflowEdge[],
): Map<string, string[]> {
  const forward = edges.filter((edge) => edge.kind !== 'loop');
  const nodes = [START, ...steps.map((step) => step.id)];
  const all = new Set(nodes);
  const dominators = new Map<string, Set<string>>(
    nodes.map((node) => [node, node === START ? new Set([START]) : all]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node === START) continue;
      const preds = forward
        .filter((edge) => edge.to === node && dominators.has(edge.from))
        .map((edge) => dominators.get(edge.from)!);
      const next = new Set<string>(
        preds.length
          ? [...preds[0]].filter((d) => preds.every((set) => set.has(d)))
          : [],
      );
      next.add(node);
      const before = dominators.get(node)!;
      if (next.size !== before.size || [...next].some((d) => !before.has(d))) {
        dominators.set(node, next);
        changed = true;
      }
    }
  }
  // A step's dominators form a chain: the closest has the most dominators.
  const depth = (node: string) => dominators.get(node)!.size;
  return new Map(
    steps.map((step) => {
      const before = [...dominators.get(step.id)!].filter(
        (d) => d !== step.id && d !== START && all.has(d),
      );
      return [step.id, before.sort((a, b) => depth(b) - depth(a))];
    }),
  );
}

/**
 * The provider of `name` for the step at `index`: the closest earlier
 * output (the closest step on every path to it, when the workflow has
 * edges), else the input.
 */
function providerOf(
  workflow: ContractWorkflow,
  index: number,
  name: string,
  paths?: Map<string, string[]>,
): Provider | undefined {
  const earlier = paths
    ? (paths.get(workflow.steps[index].id) ?? []).map((id) =>
        workflow.steps.find((step) => step.id === id)!,
      )
    : workflow.steps.slice(0, index).reverse();
  for (const step of earlier) {
    const output = step.outputSchema;
    const schema = output.properties?.[name];
    if (schema) {
      return { schema, sure: (output.required ?? []).includes(name) };
    }
  }
  const field = workflow.input.find((candidate) => candidate.name === name);
  if (!field) return undefined;
  return {
    schema: FIELD_SCHEMAS[field.type],
    sure:
      field.required || field.default !== undefined || field.type === 'boolean',
  };
}

/**
 * The workflow's broken step inputs, in step then field order (workflows
 * R26): every required input property of every step must be given, by the
 * closest earlier step's output property of the same name, else by an input
 * field of that name (text, textarea and dataset are strings, number a
 * number, boolean a boolean, datasets an array of strings), with a
 * compatible type: the same JSON type, arrays of compatible items, objects
 * with every required property given, required and compatible; an
 * `unknown` input accepts anything. An optional input is type-checked when
 * given. `missing`: nothing gives it; `type`: `expected <a>, got <b>`;
 * `optional`: an optional output (or an optional input field without a
 * default) feeds a required input. Empty when the contract holds. A
 * workflow with edges follows them, not the list order: a step's earlier
 * steps are those on every path from Start to it (`stepsOnEveryPath`).
 */
export function checkWorkflowContract(
  workflow: ContractWorkflow,
): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const paths = workflow.edges
    ? stepsOnEveryPath(workflow.steps, workflow.edges)
    : undefined;
  workflow.steps.forEach((step, index) => {
    const push = (
      field: string,
      problem: ContractProblemKind,
      message: string,
    ) => problems.push({ stepId: step.id, field, problem, message });
    const required = step.inputSchema.required ?? [];
    for (const [name, schema] of Object.entries(
      step.inputSchema.properties ?? {},
    )) {
      const provider = providerOf(workflow, index, name, paths);
      const needed = required.includes(name);
      if (!provider) {
        if (needed)
          push(name, 'missing', 'not given by the input or an earlier step');
        continue;
      }
      if (needed && !provider.sure) {
        push(name, 'optional', 'may be missing');
        continue;
      }
      compare(schema, provider.schema, name, push);
    }
  });
  return problems;
}

/**
 * The workflows, refused (thrown) when any breaks its data contract: the
 * catalogue is built through it, so a broken workflow never loads.
 */
export function assertWorkflowContracts<T extends ContractWorkflow>(
  workflows: readonly T[],
): readonly T[] {
  for (const workflow of workflows) {
    const problems = checkWorkflowContract(workflow);
    if (problems.length) {
      throw new Error(
        `Workflow "${workflow.id ?? '?'}" breaks its data contract: ${problems
          .map((entry) => `${entry.stepId}.${entry.field} ${entry.message}`)
          .join('; ')}`,
      );
    }
  }
  return workflows;
}

/**
 * A step's input or output that breaks its declared schema at run time.
 * Its message is `Contract violation in <Step title>[ (input)]: <path>
 * <zod message>` (api.md 3.6): the path dotted with indices
 * (`calls[2].rowCount`), `(root)` when the whole value is wrong. The path is
 * always one word, so a reader can take the first word after the colon.
 */
export class ContractViolationError extends Error {
  constructor(
    readonly stepTitle: string,
    readonly side: 'input' | 'output',
    readonly path: string,
    readonly issue: string,
  ) {
    super(
      `Contract violation in ${stepTitle}${side === 'input' ? ' (input)' : ''}: ${path} ${issue}`,
    );
    this.name = 'ContractViolationError';
  }
}

/** The path of an issue about the whole value. */
export const ROOT_PATH = '(root)';

/** A Zod issue path as `calls[2].rowCount`; `(root)` when empty. */
function issuePath(path: readonly PropertyKey[]): string {
  if (!path.length) return ROOT_PATH;
  return path.reduce<string>(
    (text, key) =>
      typeof key === 'number'
        ? `${text}[${key}]`
        : `${text}${text ? '.' : ''}${String(key)}`,
    '',
  );
}

/** The value parsed with the schema, or the step's contract violation (first issue). */
function parseSide<S extends z.ZodType>(
  title: string,
  side: 'input' | 'output',
  schema: S,
  value: unknown,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ContractViolationError(
    title,
    side,
    issuePath(issue?.path ?? []),
    issue?.message ?? 'Invalid value',
  );
}

/**
 * A step's input schema as the engine sees it: the declared schema (its
 * shape and types) that never refuses, so `withContract` is the one that
 * refuses a bad input, with a message naming the step. A value that does
 * not parse is passed on as is.
 */
export function engineInputSchema<S extends z.ZodType>(schema: S) {
  return schema.catch((ctx) => ctx.input as z.output<S>);
}

/**
 * A step's execute guarded by its contract (agents.md 5.12): the input is
 * parsed with the step's input schema before it runs, its output (or the
 * value it bails with) with its output schema after; either failing throws
 * a `ContractViolationError`, so the step fails and later steps do not run.
 * The step gets, and passes on, the parsed values (unknown keys dropped).
 * A step that suspends (waits for the user) has no output to check.
 */
export function withContract<P extends { inputData: unknown }, R>(
  title: string,
  schemas: { input: z.ZodType; output: z.ZodType },
  execute: (params: P) => Promise<R>,
): (params: P) => Promise<R> {
  return async (params) => {
    const inputData = parseSide(
      title,
      'input',
      schemas.input,
      params.inputData,
    );
    const bail = (params as { bail?: unknown }).bail;
    const suspend = (params as { suspend?: unknown }).suspend;
    let bailed = false;
    let suspended = false;
    const guarded = {
      ...params,
      inputData,
      ...(typeof bail === 'function'
        ? {
            bail: (value: unknown): unknown => {
              const output = parseSide(title, 'output', schemas.output, value);
              bailed = true;
              return (bail as (value: unknown) => unknown)(output);
            },
          }
        : {}),
      // A step that waits for the user (api.md 138) has no output yet: the
      // engine's suspend result is passed on as is.
      ...(typeof suspend === 'function'
        ? {
            suspend: (...args: unknown[]): unknown => {
              suspended = true;
              return (suspend as (...args: unknown[]) => unknown)(...args);
            },
          }
        : {}),
    } as P;
    const result = await execute(guarded);
    if (bailed || suspended) return result;
    return parseSide(title, 'output', schemas.output, result) as R;
  };
}
