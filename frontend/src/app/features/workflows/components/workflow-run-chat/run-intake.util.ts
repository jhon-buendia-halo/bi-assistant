import type {
  WorkflowInputField,
  WorkflowInputValue,
} from '../../models/workflow.model';

/**
 * The run chat's intake (ui.md 4.4b, *conversational run chat*): which of a
 * workflow's required inputs are still missing after the user sends a
 * message, in what order the agent asks for them, and in what words. The
 * app writes these turns itself, in the lead agent's voice; no model is
 * called. Pure functions, no framework.
 */

/** The values a run's input holds, by field name. */
export type IntakeValues = Readonly<Record<string, WorkflowInputValue>>;

/** Who speaks for the workflow in its chat: its lead agent, else the workflow. */
export interface IntakeVoice {
  name: string;
  /** The agent's role ('' for the workflow itself, or an agent without one). */
  role: string;
  /** The avatar's letter. */
  initial: string;
  /** False when no agent leads and the workflow speaks for itself. */
  agent: boolean;
}

/** The parts of a workflow the intake reads. */
export interface IntakeWorkflow {
  name: string;
  input: readonly WorkflowInputField[];
  agents: readonly { name: string; role?: string }[];
  steps: readonly {
    id: string;
    agent?: {
      name: string;
      role?: string;
      team?: readonly { name: string; role?: string }[];
    };
  }[];
}

/** How the agent asks for a field, and how the user answers it. */
export type IntakeKind = 'pick-many' | 'pick-one' | 'image' | 'text' | 'yes-no';

/** One choice of a pick: a dataset or an artifact. */
export interface IntakeOption {
  /** The value the field takes (a dataset's name, an artifact's id). */
  id: string;
  name: string;
  /** The muted line under the name (`PostgreSQL · 9 tables`). */
  detail: string;
  icon: 'database' | 'file' | 'api' | 'dashboard';
}

/** How many choices a pick shows before "Show all". */
export const INTAKE_OPTION_LIMIT = 5;

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** The step agent that leads a conversation: an orchestrator, one with a team. */
function orchestrator(workflow: IntakeWorkflow) {
  return (
    workflow.steps.find((step) => (step.agent?.team?.length ?? 0) > 0)?.agent ??
    null
  );
}

/**
 * The chat's voice: the orchestrator (Avery) when a step has one, else the
 * workflow's only agent, else the workflow itself.
 */
export function leadVoice(workflow: IntakeWorkflow): IntakeVoice {
  const lead = orchestrator(workflow);
  if (lead !== null) {
    return {
      name: lead.name,
      role: lead.role ?? '',
      initial: initialOf(lead.name),
      agent: true,
    };
  }
  if (workflow.agents.length === 1) {
    const only = workflow.agents[0];
    return {
      name: only.name,
      role: only.role ?? '',
      initial: initialOf(only.name),
      agent: true,
    };
  }
  return {
    name: workflow.name,
    role: '',
    initial: initialOf(workflow.name),
    agent: false,
  };
}

/** `Message Avery`, or `Message <workflow name>` when no agent leads. */
export function composerPlaceholder(workflow: IntakeWorkflow): string {
  return `Message ${leadVoice(workflow).name}`;
}

/** `A`, `A and B`, `A, B and C`. */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The agents a conversation talks to: the lead and its team, else every agent. */
function conversationAgents(workflow: IntakeWorkflow): string[] {
  const lead = orchestrator(workflow);
  const names =
    lead !== null
      ? [lead.name, ...(lead.team ?? []).map((member) => member.name)]
      : workflow.agents.map((agent) => agent.name);
  return [...new Set(names.filter((name) => name.trim() !== ''))];
}

/**
 * The line under the workflow's name before anything is sent:
 * `Ask Avery and Michael anything about your data.`
 */
export function emptyHint(workflow: IntakeWorkflow): string {
  const names = conversationAgents(workflow);
  const data = workflow.input.some(
    (field) => !field.hidden && field.type === 'datasets',
  );
  if (names.length === 0) return `Send a message to run ${workflow.name}.`;
  return data
    ? `Ask ${andList(names)} anything about your data.`
    : `Tell ${andList(names)} what you need.`;
}

/** Whether a value holds anything: a non-blank text, a number, a non-empty list. */
export function hasInputValue(value: WorkflowInputValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number';
}

function valueOf(
  values: IntakeValues,
  name: string,
): WorkflowInputValue | undefined {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

/**
 * The field the composer's message fills: the workflow's question (its first
 * visible text area), else its first required visible text field; null when it has neither.
 */
export function promptField(
  fields: readonly WorkflowInputField[],
  questionField: string | null,
): WorkflowInputField | null {
  const visible = fields.filter((field) => !field.hidden);
  if (questionField !== null) {
    const question = visible.find((field) => field.name === questionField);
    if (question !== undefined) return question;
  }
  return (
    visible.find((field) => field.required && field.type === 'text') ?? null
  );
}

/** How a field is asked for, and answered. */
export function intakeKind(field: WorkflowInputField): IntakeKind {
  switch (field.type) {
    case 'datasets':
      return 'pick-many';
    case 'artifact':
      return 'pick-one';
    case 'image':
    case 'images':
      return 'image';
    case 'boolean':
      return 'yes-no';
    default:
      return 'text';
  }
}

/**
 * The required inputs still missing, in declared order: every required,
 * visible field with no value. A required checkbox with no default is
 * missing until it was answered (`answered`). Of two fields that stand in
 * for each other (`requiredWithout`), only the first is asked, and neither
 * when the other holds a value.
 */
export function missingFields(
  fields: readonly WorkflowInputField[],
  values: IntakeValues,
  answered: ReadonlySet<string> = new Set(),
): WorkflowInputField[] {
  const missing: WorkflowInputField[] = [];
  for (const field of fields) {
    if (field.hidden || !field.required) continue;
    if (field.type === 'boolean') {
      if (field.default === undefined && !answered.has(field.name)) {
        missing.push(field);
      }
      continue;
    }
    if (hasInputValue(valueOf(values, field.name))) continue;
    const partner = field.requiredWithout;
    if (partner !== undefined) {
      if (hasInputValue(valueOf(values, partner))) continue;
      if (missing.some((other) => other.name === partner)) continue;
    }
    missing.push(field);
  }
  return missing;
}

/**
 * The agent a field is for, to name in the question: the agent of the first
 * step that reads it; when that is the lead itself and it has a team, its
 * first teammate (Avery asks which data Michael should look at). Null when
 * no agent step reads it.
 */
export function fieldAgent(
  field: WorkflowInputField,
  workflow: IntakeWorkflow,
): string | null {
  const stepId = field.usedBy?.[0];
  const agent =
    stepId === undefined
      ? null
      : (workflow.steps.find((step) => step.id === stepId)?.agent ?? null);
  if (agent === null) {
    const lead = orchestrator(workflow);
    return lead?.team?.[0]?.name ?? null;
  }
  return agent.team?.[0]?.name ?? agent.name;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The core of the question for one field, starting lower case. */
function askCore(field: WorkflowInputField, who: string): string {
  const label = lowerFirst(field.label);
  switch (field.type) {
    case 'datasets':
      return `which data should ${who} look at? Pick one or more datasets.`;
    case 'artifact':
      return `which ${label} should ${who} use? Pick one.`;
    case 'image':
      return `please add the ${label}: drop, paste or pick an image.`;
    case 'images':
      return `please add the ${label}: drop, paste or pick up to ${field.max ?? 4} images.`;
    case 'boolean':
      return `${label}?`;
    default:
      return `what is the ${label}?`;
  }
}

/**
 * The agent's question for a missing field, in its voice: the first one
 * opens with `Happy to. First,` after a typed message (`First,` without
 * one); later ones with `Thanks. Next,`. `voice` is who asks: a field for
 * that same agent reads `should I`.
 */
export function askText(
  field: WorkflowInputField,
  workflow: IntakeWorkflow,
  options: { first: boolean; typed: boolean },
): string {
  const voice = leadVoice(workflow);
  const user = fieldAgent(field, workflow);
  const who = user === null || user === voice.name ? 'I' : user;
  const core = askCore(field, who);
  if (!options.first) return `Thanks. Next, ${core}`;
  return options.typed ? `Happy to. First, ${core}` : `First, ${core}`;
}

/** The composer's placeholder while the agent waits on a field. */
export function pendingPlaceholder(
  field: WorkflowInputField,
  fallback: string,
): string {
  switch (intakeKind(field)) {
    case 'pick-many':
    case 'pick-one':
      return field.type === 'artifact'
        ? `Or type a ${lowerFirst(field.label)} name…`
        : 'Or type a dataset name…';
    case 'text':
      return field.placeholder ?? `Type the ${lowerFirst(field.label)}…`;
    case 'image':
      return 'Or paste an image…';
    default:
      return fallback;
  }
}

/** `Continue with 1 dataset`, `Continue with 3 datasets`. */
export function continueLabel(count: number): string {
  return `Continue with ${count} dataset${count === 1 ? '' : 's'}`;
}

const KIND_ICONS: Record<string, IntakeOption['icon']> = {
  file: 'file',
  rest: 'api',
};

/** A dataset as a pick's choice: `PostgreSQL · 9 tables`. */
export function datasetOption(
  dataset: {
    name: string;
    datasourceKind?: string;
    tables: readonly string[];
  },
  kindLabel: (kind: string | undefined) => string,
): IntakeOption {
  const count = dataset.tables.length;
  const tables = `${count} table${count === 1 ? '' : 's'}`;
  return {
    id: dataset.name,
    name: dataset.name,
    detail:
      dataset.datasourceKind === undefined
        ? tables
        : `${kindLabel(dataset.datasourceKind)} · ${tables}`,
    icon: KIND_ICONS[dataset.datasourceKind ?? ''] ?? 'database',
  };
}

/** An artifact as a pick's choice: `Dashboard · 6 widgets`. */
export function artifactOption(artifact: {
  id: string;
  name: string;
  kind: string;
  widgetCount: number;
}): IntakeOption {
  const kind = artifact.kind.charAt(0).toUpperCase() + artifact.kind.slice(1);
  const n = artifact.widgetCount;
  return {
    id: artifact.id,
    name: artifact.name,
    detail: `${kind} · ${n} widget${n === 1 ? '' : 's'}`,
    icon: 'dashboard',
  };
}

/**
 * The choices a pick shows: those whose name holds `query` (any case), the
 * first `limit` unless `all`; `total` is how many match.
 */
export function shownOptions(
  options: readonly IntakeOption[],
  query: string,
  all: boolean,
  limit = INTAKE_OPTION_LIMIT,
): { shown: IntakeOption[]; total: number } {
  const q = query.trim().toLowerCase();
  const matching =
    q === ''
      ? [...options]
      : options.filter((option) => option.name.toLowerCase().includes(q));
  return {
    shown: all ? matching : matching.slice(0, limit),
    total: matching.length,
  };
}

/**
 * The choice a typed name picks: the one named exactly (any case), else
 * the only one whose name holds it; null otherwise.
 */
export function typedOption(
  options: readonly IntakeOption[],
  query: string,
): IntakeOption | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const exact = options.find((option) => option.name.toLowerCase() === q);
  if (exact !== undefined) return exact;
  const matching = options.filter((option) =>
    option.name.toLowerCase().includes(q),
  );
  return matching.length === 1 ? matching[0] : null;
}

/**
 * The agent's message for a refused start: `I couldn't start yet: <first
 * error>.` with each further error after it.
 */
export function refusalText(messages: readonly string[]): string {
  const list = messages
    .map((message) => message.trim().replace(/\.$/, ''))
    .filter(Boolean);
  if (list.length === 0) return "I couldn't start the run.";
  return `I couldn't start yet: ${list.join('. ')}.`;
}

/** A checkbox label split at its first colon: `Build a visual` and its detail. */
export function optionLabel(label: string): { title: string; detail: string } {
  const at = label.indexOf(':');
  if (at <= 0) return { title: label, detail: '' };
  return {
    title: label.slice(0, at).trim(),
    detail: label.slice(at + 1).trim(),
  };
}
