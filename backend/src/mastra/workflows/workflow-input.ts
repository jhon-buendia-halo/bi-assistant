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
  /**
   * One image, sent as a `data:` URL (PNG, JPEG or WebP, at most
   * `IMAGE_MAX_BYTES`). A run stores it as a file of its workspace and
   * keeps the file's path as the field's value.
   */
  | 'image'
  /**
   * Reference images (workflows R35): a list of at most `max` (and never
   * more than `IMAGES_MAX_COUNT`) images, each sent as a `data:` URL of a
   * PNG, JPEG or WebP file of at most `IMAGE_MAX_BYTES`. A run stores each
   * as a file of its workspace, `inputs/<field>/<n>.<extension>` (`n` from
   * 1, in the list's order), and keeps the paths as the field's value.
   */
  | 'images'
  /** The id of one stored artifact (data-model 3.18). */
  | 'artifact';

/** The largest image an `image` field, or one of an `images` field, takes, in bytes. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The most images an `images` field takes (workflows R35). */
export const IMAGES_MAX_COUNT = 4;

/** The image types an `image` or `images` field takes, with their file extension. */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Whether the bytes start as a file of the media type does. */
function hasImageSignature(mediaType: string, data: Buffer): boolean {
  if (mediaType === 'image/png') {
    return data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  }
  if (mediaType === 'image/jpeg') {
    return data.subarray(0, 3).toString('hex') === 'ffd8ff';
  }
  return (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

/**
 * The image of a base64 `data:` URL: its media type and bytes. Undefined
 * when the value is no such URL, its type is not one an `image` field
 * takes, or its bytes are not a file of that type.
 */
export function imageOfDataUrl(
  value: unknown,
): { mediaType: string; data: Buffer } | undefined {
  if (typeof value !== 'string') return undefined;
  const found =
    /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value.trim(),
    );
  if (!found || !Object.hasOwn(IMAGE_EXTENSIONS, found[1])) return undefined;
  const data = Buffer.from(found[2], 'base64');
  return hasImageSignature(found[1], data)
    ? { mediaType: found[1], data }
    : undefined;
}

/** The datasource kinds a `datasets` field can be limited to. */
export type InputDatasourceKind = 'postgres' | 'databricks' | 'rest' | 'file';

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
  /** `datasets`: only datasets bound to these kinds. */
  datasourceKinds?: InputDatasourceKind[];
  /** `artifact`: only artifacts of these kinds. */
  artifactKinds?: string[];
  /**
   * The name of another field: this field is required only while that one
   * has no value. Two fields that name each other take one of the two.
   */
  requiredWithout?: string;
  /** Set by the app, never rendered as a control. */
  hidden?: boolean;
  /** `text` / `textarea`: the most characters of the trimmed text. */
  maxLength?: number;
  /** `number`: the smallest value. */
  min?: number;
  /**
   * `number`: the largest value. `images`: the most images (at most
   * `IMAGES_MAX_COUNT`, which is also the limit when it is absent).
   */
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

/** A dataset a `datasets` field is checked against. */
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
  /** The stored artifacts an `artifact` field is checked against. */
  artifacts?: readonly InputArtifact[];
}

/** An artifact an `artifact` field is checked against. */
export interface InputArtifact {
  id: string;
  kind: string;
}

export type WorkflowInputValidation =
  | { ok: true; input: WorkflowInputValues }
  | { ok: false; errors: WorkflowInputError[] };

/** How a refusal names a datasource kind. */
const KIND_LABELS: Record<InputDatasourceKind, string> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks',
  rest: 'REST',
  file: 'Excel / CSV',
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

/**
 * An `images` field's value (workflows R35): a list of `data:` URLs, blank
 * entries dropped; none is a missing field. More than the field's `max`
 * (never more than `IMAGES_MAX_COUNT`), an entry that is no PNG, JPEG or
 * WebP image, or one over `IMAGE_MAX_BYTES` is refused, in that order.
 */
function imagesCheck(field: WorkflowInputField, value: unknown): FieldCheck {
  if (value === undefined || value === null || value === '') {
    return missingField(field);
  }
  const wrongType: FieldCheck = {
    ok: false,
    error: `${field.label} must be PNG, JPEG or WebP images`,
  };
  if (!Array.isArray(value)) return wrongType;
  const given = value.filter(
    (entry) => !(typeof entry === 'string' && entry.trim() === ''),
  );
  if (!given.length) return missingField(field);
  const max = Math.min(field.max ?? IMAGES_MAX_COUNT, IMAGES_MAX_COUNT);
  if (given.length > max) {
    return { ok: false, error: `${field.label} must be at most ${max} images` };
  }
  const images = given.map((entry) => imageOfDataUrl(entry));
  if (images.some((image) => !image)) return wrongType;
  if (images.some((image) => image!.data.byteLength > IMAGE_MAX_BYTES)) {
    return {
      ok: false,
      error: `${field.label} must be at most ${IMAGE_MAX_BYTES / (1024 * 1024)} MB each`,
    };
  }
  return { ok: true, value: given.map((entry) => String(entry).trim()) };
}

/** One field's value checked against its type and rules (plan 4.1). */
function checkField(
  field: WorkflowInputField,
  value: unknown,
  datasets: readonly InputDataset[],
  artifacts: readonly InputArtifact[] = [],
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
  if (field.type === 'images') return imagesCheck(field, value);
  const usable =
    (typeof value === 'string' && value.trim() !== '') ||
    typeof value === 'number';
  if (!usable) return missingField(field);
  if (field.type === 'artifact') {
    const id = String(value).trim();
    const found = artifacts.find((artifact) => artifact.id === id);
    const kinds = field.artifactKinds;
    return found && (!kinds?.length || kinds.includes(found.kind))
      ? { ok: true, value: id }
      : { ok: false, error: `Artifact "${id}" not found` };
  }
  if (field.type === 'image') {
    const image = imageOfDataUrl(value);
    if (!image) {
      return {
        ok: false,
        error: `${field.label} must be a PNG, JPEG or WebP image`,
      };
    }
    if (image.data.byteLength > IMAGE_MAX_BYTES) {
      return {
        ok: false,
        error: `${field.label} must be at most ${IMAGE_MAX_BYTES / (1024 * 1024)} MB`,
      };
    }
    return { ok: true, value: String(value).trim() };
  }
  if (field.type === 'number') {
    const typed = typeof value === 'string' ? value.trim() : '';
    const number =
      typeof value === 'number' ? value : typed ? Number(typed) : NaN;
    return Number.isFinite(number)
      ? numberCheck(field, number)
      : { ok: false, error: `${field.label} must be a number` };
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
 * repeats, an image as a base64 `data:` URL of a PNG, JPEG or WebP file of
 * at most `IMAGE_MAX_BYTES`, reference images (`images`) as a list of at
 * most `max` such URLs (blank entries dropped; workflows R35), an
 * artifact as the id of a stored artifact of
 * the field's kinds. Of two fields that name each other in
 * `requiredWithout`, one must be given (`<label> or <other label> is
 * required`, on the first of the two); when both are, an image gives way. A field that is missing, `""` or whitespace-only takes its
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
    const checked = checkField(
      field,
      value,
      ctx.datasets ?? [],
      ctx.artifacts ?? [],
    );
    if (!checked.ok) {
      errors.push({ field: field.name, message: checked.error });
    } else if (checked.value !== undefined) {
      input[field.name] = checked.value;
    }
  }
  // One of two fields that stand in for each other (`requiredWithout`).
  const reported = new Set<string>();
  for (const field of workflow.input) {
    const other = workflow.input.find(
      (candidate) => candidate.name === field.requiredWithout,
    );
    if (!other || reported.has(field.name)) continue;
    const failed = (name: string) =>
      errors.some((error) => error.field === name);
    const given = (name: string) => Object.hasOwn(input, name);
    if (given(field.name) || given(other.name)) {
      // With both, an image gives way: the run does not read it.
      if (given(field.name) && given(other.name) && field.type === 'image') {
        delete input[field.name];
      }
      continue;
    }
    // A refused value is that field's own error, not a missing one.
    if (failed(field.name) || failed(other.name)) continue;
    reported.add(other.name);
    errors.push({
      field: field.name,
      message: `${field.label} or ${other.label} is required`,
    });
  }
  if (!errors.length) return { ok: true, input };
  // Field order, as a form reads them.
  const order = new Map(
    workflow.input.map((field, index) => [field.name, index]),
  );
  errors.sort(
    (a, b) => (order.get(a.field ?? '') ?? 0) - (order.get(b.field ?? '') ?? 0),
  );
  return { ok: false, errors };
}

/** An image taken out of a run's input: where the run stores it. */
export interface InputImageFile {
  /** The field it came from. */
  field: string;
  /**
   * Its path in the run's workspace: `inputs/<field>.<extension>` for an
   * `image` field, `inputs/<field>/<n>.<extension>` for each image of an
   * `images` field (`n` from 1, in the list's order: `inputs/images/1.png`).
   */
  path: string;
  mediaType: string;
  data: Buffer;
}

/**
 * A checked input with every image's `data:` URL taken out, so no image is
 * stored in the run's document nor sent back with it: an `image` field's
 * value becomes the path the run stores the file at, and each entry of an
 * `images` field becomes its own path (`inputs/images/<n>.<ext>`, `n` from
 * 1; an entry that is no `data:` URL is kept as it is). `images` lists
 * every file to write, in field then list order.
 */
export function withStoredImages(
  workflow: { input: readonly WorkflowInputField[] },
  input: WorkflowInputValues,
): { input: WorkflowInputValues; images: InputImageFile[] } {
  const stored: WorkflowInputValues = { ...input };
  const images: InputImageFile[] = [];
  for (const field of workflow.input) {
    if (field.type === 'images') {
      const list = input[field.name];
      if (!Array.isArray(list)) continue;
      stored[field.name] = list.map((entry, index) => {
        const image = imageOfDataUrl(entry);
        if (!image) return entry;
        const path = `inputs/${field.name}/${index + 1}.${IMAGE_EXTENSIONS[image.mediaType]}`;
        images.push({ field: field.name, path, ...image });
        return path;
      });
      continue;
    }
    if (field.type !== 'image') continue;
    const image = imageOfDataUrl(input[field.name]);
    if (!image) continue;
    const path = `inputs/${field.name}.${IMAGE_EXTENSIONS[image.mediaType]}`;
    stored[field.name] = path;
    images.push({ field: field.name, path, ...image });
  }
  return { input: stored, images };
}
