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
 * How a workflow is started (ADR-0040 amendment; plan 9.1): `chat` runs it
 * on every message of a chat; `run` runs it once on a typed input, and its
 * result is shown on its page and never stored.
 */
export type WorkflowTrigger = 'chat' | 'run';

/** One field of a run workflow's input, defined in code (api.md 116). */
export interface WorkflowInputField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  required: boolean;
  placeholder?: string;
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
    trigger: 'chat',
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
];

/** Every one-step workflow (`agent:*`) runs in a chat. */
export const ONE_STEP_WORKFLOW_TRIGGER: WorkflowTrigger = 'chat';

/** Whether a code workflow can start a chat (`POST /sessions { workflowId }`). */
export function workflowStartsChat(source: CodeWorkflowSource): boolean {
  return source.trigger === 'chat';
}

/** A run's input values, by field name. */
export type WorkflowInputValues = Record<string, string | number>;

/**
 * A run's input checked against the workflow's fields (api.md 118): the
 * declared fields only, a number field as a number. A required field that is
 * missing or empty is refused with `<label> is required`, a number field
 * that is not a number with `<label> must be a number`. A whitespace-only
 * text passes: the run decides what it means. An optional field that is
 * missing or empty is left out.
 */
export function parseWorkflowInput(
  fields: readonly WorkflowInputField[],
  raw: unknown,
): { ok: true; values: WorkflowInputValues } | { ok: false; error: string } {
  const body =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const values: WorkflowInputValues = {};
  for (const field of fields) {
    const value = Object.hasOwn(body, field.name)
      ? body[field.name]
      : undefined;
    const usable =
      (typeof value === 'string' && value !== '') || typeof value === 'number';
    if (!usable) {
      if (field.required) {
        return { ok: false, error: `${field.label} is required` };
      }
      continue;
    }
    if (field.type === 'number') {
      const typed = typeof value === 'string' ? value.trim() : '';
      const number =
        typeof value === 'number' ? value : typed ? Number(typed) : NaN;
      if (!Number.isFinite(number)) {
        return { ok: false, error: `${field.label} must be a number` };
      }
      values[field.name] = number;
    } else {
      values[field.name] = String(value);
    }
  }
  return { ok: true, values };
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
    (workflow) => workflow.primaryFor === agentKey,
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
