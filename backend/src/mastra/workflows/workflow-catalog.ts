/**
 * The workflow catalogue (ADR-0040; agents.md 5.12): the workflows defined in
 * code, the built-in agents that get a one-step workflow, workflow ids and
 * the rule that derives a session's workflow from its stored agent binding.
 * Plain data and pure functions, no framework import, so the sessions and
 * agents services and Jest can read it without loading Mastra. The API's
 * catalogue (names, datasets, requirements) is built from it by
 * `WorkflowsService`.
 */
import {
  ASSISTANT_MAX_STEPS,
  DATA_READINESS_MAX_STEPS,
  RFP_MAX_STEPS,
  SYSTEM_AGENT_KEYS,
} from '../agent-constants';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_DESCRIPTION,
  ASSISTANT_V2_NAME,
} from '../agents/assistant-v2-catalog';
import { AGENT_TURN_STEPS } from './agent-turn.steps';
import {
  DEEP_ANALYSIS_AGENT_KEY,
  DEEP_ANALYSIS_STEPS,
  DEEP_ANALYSIS_WORKFLOW_ID,
} from './deep-analysis.steps';
import type { AgentWorkflow } from './agent-workflows';
import {
  QTI_V2_TURN_STEPS,
  QTI_V2_TURN_WORKFLOW_ID,
  type WorkflowStepEntry,
} from './qti-v2-turn.steps';
import {
  SEQ_TEXT_DEMO_STEPS,
  SEQ_TEXT_DEMO_WORKFLOW_ID,
} from './seq-text-demo.steps';

/** What drives a chat's workflow bar: the workflow's steps, or the agent's own phases. */
export type WorkflowBar = 'steps' | 'agent';

/**
 * How a workflow is started: every workflow runs once on a typed input
 * (`POST /workflows/:id/runs`, ADR-0040 amendment; chats retired in 1.23.22),
 * and its result is shown on its page.
 */
export type WorkflowTrigger = 'run';

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
  /** Set by the app (the RFP Builder's Continue), never rendered as a control. */
  hidden?: boolean;
}

/** The placeholder of an agent workflow's question. */
const QUESTION_PLACEHOLDER = 'Ask a question about your data';
/** What a Data Readiness run asks when its question is left empty. */
export const READINESS_DEFAULT_QUESTION =
  'Assess the readiness of this dataset';

const QUESTION_FIELD: WorkflowInputField = {
  name: 'question',
  label: 'Question',
  type: 'textarea',
  required: true,
  placeholder: QUESTION_PLACEHOLDER,
};
const DATASETS_FIELD: WorkflowInputField = {
  name: 'datasets',
  label: 'Datasets',
  type: 'datasets',
  required: true,
};
const CAREFUL_FIELD: WorkflowInputField = {
  name: 'careful',
  label: 'Careful: cross-check the result with an independent query',
  type: 'boolean',
  required: false,
  default: false,
};

/** The input of each wrapped built-in agent's one-step workflow (plan 4.2). */
const BUILTIN_AGENT_INPUTS: Readonly<
  Record<string, readonly WorkflowInputField[]>
> = {
  assistant: [QUESTION_FIELD, DATASETS_FIELD, CAREFUL_FIELD],
  'data-readiness': [
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
      placeholder: READINESS_DEFAULT_QUESTION,
      default: READINESS_DEFAULT_QUESTION,
    },
  ],
  rfp: [
    {
      name: 'message',
      label: 'Message',
      type: 'textarea',
      required: true,
      placeholder: 'Name the client and plan year, or state your decision',
    },
    {
      name: 'rfpId',
      label: 'RFP',
      type: 'text',
      required: false,
      hidden: true,
    },
  ],
};

/** A user agent's one-step workflow: its datasets are the agent's (plan 4.2). */
const USER_AGENT_INPUT: readonly WorkflowInputField[] = [
  QUESTION_FIELD,
  CAREFUL_FIELD,
];

/** Copies of fields, so a caller can change them safely. */
function copyFields(
  fields: readonly WorkflowInputField[],
): WorkflowInputField[] {
  return fields.map((field) => ({
    ...field,
    ...(field.datasourceKinds
      ? { datasourceKinds: [...field.datasourceKinds] }
      : {}),
  }));
}

/**
 * The input of an agent's one-step workflow (plan 4.2): a wrapped built-in
 * agent's own fields, else a user agent's (question and careful).
 */
export function oneStepWorkflowInput(
  agentKeyOrId: string,
): WorkflowInputField[] {
  return copyFields(
    Object.hasOwn(BUILTIN_AGENT_INPUTS, agentKeyOrId)
      ? BUILTIN_AGENT_INPUTS[agentKeyOrId]
      : USER_AGENT_INPUT,
  );
}

/** One workflow defined in code. */
export interface CodeWorkflowSource {
  id: string;
  name: string;
  description: string;
  /**
   * Registry key of the agent its agent step runs: that agent gets no
   * one-step workflow. A run workflow may call no agent.
   */
  primaryFor?: string;
  /**
   * Registry key of the agent a run workflow's agent steps call without
   * being that agent's workflow (deep analysis calls the assistant, which
   * keeps its own one-step workflow).
   */
  calls?: string;
  trigger: WorkflowTrigger;
  /** The typed input of a run workflow, in form order. */
  input?: readonly WorkflowInputField[];
  steps: readonly WorkflowStepEntry[];
  /** `steps` for every code workflow today. */
  bar: WorkflowBar;
}

/** The workflows defined in code, in catalogue order. */
export const CODE_WORKFLOWS: readonly CodeWorkflowSource[] = [
  {
    id: QTI_V2_TURN_WORKFLOW_ID,
    name: ASSISTANT_V2_NAME,
    description: ASSISTANT_V2_DESCRIPTION,
    primaryFor: ASSISTANT_V2_AGENT_KEY,
    trigger: 'run',
    input: [QUESTION_FIELD, DATASETS_FIELD],
    steps: QTI_V2_TURN_STEPS,
    bar: 'steps',
  },
  {
    id: SEQ_TEXT_DEMO_WORKFLOW_ID,
    name: 'Sequential test workflow',
    description:
      'A three-step example: cleans a text, counts its words and characters, and formats the result. No LLM.',
    trigger: 'run',
    input: [
      {
        name: 'text',
        label: 'Text',
        type: 'textarea',
        required: true,
        placeholder: 'Paste or type any text',
      },
    ],
    steps: SEQ_TEXT_DEMO_STEPS,
    bar: 'steps',
  },
  {
    id: DEEP_ANALYSIS_WORKFLOW_ID,
    name: 'Deep analysis',
    description:
      'Investigates a broad question from several angles with SQL and writes a downloadable report: executive summary, findings, anomalies and recommendations. Takes a few minutes.',
    calls: DEEP_ANALYSIS_AGENT_KEY,
    trigger: 'run',
    input: [QUESTION_FIELD, DATASETS_FIELD],
    steps: DEEP_ANALYSIS_STEPS,
    bar: 'steps',
  },
];

/** Every one-step workflow (`agent:*`) runs on its input. */
export const ONE_STEP_WORKFLOW_TRIGGER: WorkflowTrigger = 'run';

/** One value of a run's input. */
export type WorkflowInputValue = string | number | boolean | string[];

/** A run's input values, by field name. */
export type WorkflowInputValues = Record<string, WorkflowInputValue>;

/** A dataset a `dataset` or `datasets` field is checked against. */
export interface InputDataset {
  name: string;
  datasourceKind?: string;
}

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

/** One field's value checked against its type (plan 4.1). */
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
    (typeof value === 'string' && value !== '') || typeof value === 'number';
  if (!usable) return missingField(field);
  if (field.type === 'number') {
    const typed = typeof value === 'string' ? value.trim() : '';
    const number =
      typeof value === 'number' ? value : typed ? Number(typed) : NaN;
    return Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false, error: `${field.label} must be a number` };
  }
  if (field.type === 'dataset') {
    const name = String(value).trim();
    if (!name) return missingField(field);
    const error = datasetError(field, name, datasets);
    return error ? { ok: false, error } : { ok: true, value: name };
  }
  return { ok: true, value: String(value) };
}

/**
 * A run's input checked against the workflow's fields (api.md 118, 119;
 * plan 4.1), in field order, the first refusal winning: the declared fields
 * only, a number field as a number, a boolean as a boolean, datasets as
 * trimmed names in order without repeats. A field that is missing or empty
 * takes its `default` (a boolean `false`); a required one without a default
 * is refused with `<label> is required` (`Select at least one dataset` for
 * `datasets`). `<label> must be a number`, `<label> must be true or false`,
 * `Dataset "<name>" not found` and `Dataset "<name>" is not a <kinds>
 * dataset` refuse a value of the wrong kind. A whitespace-only text passes:
 * the run decides what it means. An optional field that is missing or empty
 * and has no default is left out.
 */
export function parseWorkflowInput(
  fields: readonly WorkflowInputField[],
  raw: unknown,
  datasets: readonly InputDataset[] = [],
): { ok: true; values: WorkflowInputValues } | { ok: false; error: string } {
  const body =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const values: WorkflowInputValues = {};
  for (const field of fields) {
    const value = Object.hasOwn(body, field.name)
      ? body[field.name]
      : undefined;
    const checked = checkField(field, value, datasets);
    if (!checked.ok) return checked;
    if (checked.value !== undefined) values[field.name] = checked.value;
  }
  return { ok: true, values };
}

/** What one agent turn of a run takes from the run's input (plan 4.2, 5.1). */
export interface AgentRunTurn {
  /** The user message: `question`, or the RFP Builder's `message`, trimmed. */
  question: string;
  /** `datasets`, or the readiness run's one `dataset`; absent otherwise. */
  datasets?: string[];
  /** Careful mode (the Assistant and user agents). */
  careful: boolean;
  /** The RFP the run continues (the RFP Builder's hidden field). */
  rfpId?: string;
}

/** The agent turn a run's checked input asks for (plan 4.2). */
export function agentRunTurn(values: WorkflowInputValues): AgentRunTurn {
  const text = (value: WorkflowInputValue | undefined) =>
    typeof value === 'string' ? value.trim() : '';
  const datasets = Array.isArray(values['datasets'])
    ? values['datasets']
    : text(values['dataset'])
      ? [text(values['dataset'])]
      : undefined;
  const rfpId = text(values['rfpId']);
  return {
    question: text(values['question']) || text(values['message']),
    ...(datasets ? { datasets } : {}),
    careful: values['careful'] === true,
    ...(rfpId ? { rfpId } : {}),
  };
}

/** The built-in agents that get a one-step workflow. */
export const WRAPPED_AGENT_KEYS: readonly string[] = [
  'assistant',
  'rfp',
  'data-readiness',
];

/** The prefix of a one-step workflow's id. */
export const AGENT_WORKFLOW_PREFIX = 'agent:';

/** The plain assistant's one-step workflow: what a session with no agent runs. */
export const ASSISTANT_WORKFLOW_ID = 'agent:assistant';
/** Its name and description: the picker's, so the Sessions chip keeps reading `Assistant`. */
export const ASSISTANT_WORKFLOW_NAME = 'Assistant';
export const ASSISTANT_WORKFLOW_DESCRIPTION =
  'Answers questions over the datasets you pick.';

/** The id of an agent's one-step workflow: `agent:` + its registry key or user-agent id. */
export function agentWorkflowId(agentKeyOrId: string): string {
  return `${AGENT_WORKFLOW_PREFIX}${agentKeyOrId}`;
}

export type ParsedWorkflowId =
  | { kind: 'code'; source: CodeWorkflowSource }
  | { kind: 'builtin-agent'; agentKey: string }
  | { kind: 'user-agent'; agentId: string };

/**
 * What a workflow id names. Undefined for an unknown id, a System agent's
 * key and the `primaryFor` agent of a code workflow (it runs that workflow,
 * never a one-step one). Any other `agent:` id names a user agent: the
 * caller checks it exists and is Live.
 */
export function parseWorkflowId(id: string): ParsedWorkflowId | undefined {
  const source = CODE_WORKFLOWS.find((workflow) => workflow.id === id);
  if (source) return { kind: 'code', source };
  if (typeof id !== 'string' || !id.startsWith(AGENT_WORKFLOW_PREFIX)) {
    return undefined;
  }
  const key = id.slice(AGENT_WORKFLOW_PREFIX.length);
  if (!key) return undefined;
  if (WRAPPED_AGENT_KEYS.includes(key)) {
    return { kind: 'builtin-agent', agentKey: key };
  }
  if (
    SYSTEM_AGENT_KEYS.includes(key) ||
    CODE_WORKFLOWS.some((workflow) => workflow.primaryFor === key)
  ) {
    return undefined;
  }
  return { kind: 'user-agent', agentId: key };
}

/** The stored fields a session's workflow is derived from (data-model 3.4). */
export interface SessionWorkflowFields {
  workflowId?: string;
  agentKey?: string;
  agentId?: string;
}

/**
 * The workflow a session runs (plan 4.3): its stored `workflowId` while that
 * still resolves, else the one its agent fields derive: the code workflow
 * whose `primaryFor` is its `agentKey`, `agent:<agentKey>` for a wrapped
 * built-in agent, `agent:<agentId>` for a user agent (deleted or not), and
 * `agent:assistant` otherwise.
 */
export function sessionWorkflowId(session: SessionWorkflowFields): string {
  if (session.workflowId && parseWorkflowId(session.workflowId)) {
    return session.workflowId;
  }
  if (session.agentKey) {
    const code = CODE_WORKFLOWS.find(
      (workflow) => workflow.primaryFor === session.agentKey,
    );
    if (code) return code.id;
    if (WRAPPED_AGENT_KEYS.includes(session.agentKey)) {
      return agentWorkflowId(session.agentKey);
    }
    return ASSISTANT_WORKFLOW_ID;
  }
  if (session.agentId) return agentWorkflowId(session.agentId);
  return ASSISTANT_WORKFLOW_ID;
}

/**
 * The ids of the workflows whose steps call an agent, in catalogue order: a
 * built-in agent's code workflows and its one-step workflow; a user agent's
 * one-step workflow while it is Live. System agents are used in none.
 */
export function workflowsUsingAgent(
  agentKey: string,
  opts: { userAgentLive?: boolean; builtin: boolean },
): string[] {
  if (!opts.builtin) {
    return opts.userAgentLive ? [agentWorkflowId(agentKey)] : [];
  }
  const wrapped = WRAPPED_AGENT_KEYS.includes(agentKey)
    ? agentWorkflowId(agentKey)
    : undefined;
  const code = CODE_WORKFLOWS.filter(
    (workflow) =>
      workflow.primaryFor === agentKey || workflow.calls === agentKey,
  ).map((workflow) => workflow.id);
  // The assistant's workflow leads the catalogue; the other one-step
  // workflows follow the code-defined ones.
  if (wrapped === ASSISTANT_WORKFLOW_ID) return [wrapped, ...code];
  return wrapped ? [...code, wrapped] : code;
}

/**
 * The tool-loop budget of a one-step workflow's agent: 10 for the Data
 * Readiness Agent, 15 for the assistant, the RFP Builder and user agents.
 */
export function wrappedAgentMaxSteps(agentKeyOrId: string): number {
  if (agentKeyOrId === 'rfp') return RFP_MAX_STEPS;
  if (agentKeyOrId === 'data-readiness') return DATA_READINESS_MAX_STEPS;
  return ASSISTANT_MAX_STEPS;
}

/** The tool that ends a turn with a clarifying question (agents.md 3.6). */
const CLARIFICATION_TOOL = 'ask_clarification';

/**
 * The steps of a one-step workflow: `agent-turn`'s `answer` step running
 * `agent`, with a `Clarifying question` exit when the agent can ask one.
 */
export function oneStepWorkflowSteps(agent: {
  name: string;
  tools: string[];
  maxSteps: number;
}): AgentWorkflow['steps'] {
  return AGENT_TURN_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    kind: step.kind,
    summary: step.summary,
    input: [...step.input],
    output: [...step.output],
    agent: {
      name: agent.name,
      tools: [...agent.tools],
      maxSteps: agent.maxSteps,
    },
    exits: [
      ...step.exits.map((exit) => ({ ...exit })),
      ...(agent.tools.includes(CLARIFICATION_TOOL)
        ? [{ label: 'Clarifying question', outcome: 'stops' as const }]
        : []),
    ],
  }));
}
