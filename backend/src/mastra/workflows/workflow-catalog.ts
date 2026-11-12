/**
 * The workflow catalogue (ADR-0040; agents.md 5.12): the workflows defined in
 * code (only Questions to Insights v2, `qti-v2-turn`, since 1.23.35), and the
 * turn routing of the agent-turn engine: the `agent:<key>` ids a run host, a
 * draft run or a stored session is bound to, and the rule that derives a
 * session's workflow from its stored agent binding. An `agent:` id names the
 * engine an agent turn runs on, never a catalogue workflow: `GET /workflows`
 * lists none. Plain data and pure functions, no framework import, so the
 * sessions and agents services and Jest can read it without loading Mastra.
 * The API's catalogue is built from it by `WorkflowsService`.
 */
import {
  ASSISTANT_MAX_STEPS,
  DATA_READINESS_MAX_STEPS,
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
  assertWorkflowInputCoverage,
  type WorkflowInputField,
  type WorkflowInputValue,
  type WorkflowInputValues,
} from './workflow-input';

export type {
  InputDatasourceKind,
  InputDataset,
  WorkflowInputField,
  WorkflowInputFieldDetail,
  WorkflowInputFieldType,
  WorkflowInputValue,
  WorkflowInputValues,
} from './workflow-input';

/** What drives a chat's workflow bar: the workflow's steps, or the agent's own phases. */
export type WorkflowBar = 'steps' | 'agent';

/**
 * How a workflow is started: every workflow runs once on a typed input
 * (`POST /workflows/:id/runs`, ADR-0040 amendment; chats retired in 1.23.22),
 * and its result is shown on its page.
 */
export type WorkflowTrigger = 'run';

/** The placeholder of a run's question. */
const QUESTION_PLACEHOLDER = 'Ask a question about your data';

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

/**
 * The input of a draft run (Try it, api.md R12): the question, and careful
 * mode; its datasets are the draft's.
 */
export function draftRunInput(): WorkflowInputField[] {
  return [{ ...QUESTION_FIELD }, { ...CAREFUL_FIELD }];
}

/** One workflow defined in code. */
export interface CodeWorkflowSource {
  id: string;
  name: string;
  description: string;
  /** Registry key of the agent its agent step runs. */
  primaryFor: string;
  trigger: WorkflowTrigger;
  /** The typed input of a run, in form order. */
  input: readonly WorkflowInputField[];
  steps: readonly WorkflowStepEntry[];
  /** `steps` for every code workflow today. */
  bar: WorkflowBar;
}

/** The longest question a run takes, in characters (trimmed). */
export const QUESTION_MAX_LENGTH = 4000;

/**
 * The workflows defined in code, in catalogue order. Built through the
 * input-coverage check: a workflow whose steps read a field that neither
 * its input nor an earlier step gives throws here, so it never loads.
 */
export const CODE_WORKFLOWS: readonly CodeWorkflowSource[] =
  assertWorkflowInputCoverage<CodeWorkflowSource>([
    {
      id: QTI_V2_TURN_WORKFLOW_ID,
      name: ASSISTANT_V2_NAME,
      description: ASSISTANT_V2_DESCRIPTION,
      primaryFor: ASSISTANT_V2_AGENT_KEY,
      trigger: 'run',
      input: [
        { ...QUESTION_FIELD, maxLength: QUESTION_MAX_LENGTH },
        DATASETS_FIELD,
      ],
      steps: QTI_V2_TURN_STEPS,
      bar: 'steps',
    },
  ]);

/** What one agent turn of a run takes from the run's input (plan 4.2, 5.1). */
export interface AgentRunTurn {
  /** The user message: `question`, trimmed. */
  question: string;
  /** `datasets`, or the readiness run's one `dataset`; absent otherwise. */
  datasets?: string[];
  /** Careful mode (the Assistant and user agents). */
  careful: boolean;
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
  return {
    question: text(values['question']),
    ...(datasets ? { datasets } : {}),
    careful: values['careful'] === true,
  };
}

/**
 * The built-in agents whose turns run on the agent-turn engine: a stored
 * session of theirs, and the eval runner's direct host (agents.md 5.14).
 * They have no catalogue workflow since 1.23.35.
 */
export const WRAPPED_AGENT_KEYS: readonly string[] = [
  'assistant',
  'data-readiness',
];

/** The prefix of an agent-turn binding's id. */
export const AGENT_WORKFLOW_PREFIX = 'agent:';

/** The plain assistant's agent-turn binding: what a session with no agent runs. */
export const ASSISTANT_WORKFLOW_ID = 'agent:assistant';
/** Its name, so an old session's chip keeps reading `Assistant`. */
export const ASSISTANT_WORKFLOW_NAME = 'Assistant';

/**
 * The catalogue workflows whose agent step runs an agent, as an agent's
 * detail lists them (api.md 34 `usedInWorkflows`): `qti-v2-turn` for
 * `assistant-v2`, none for any other agent.
 */
export function workflowsUsingAgent(
  agentKey: string,
): { id: string; name: string }[] {
  return CODE_WORKFLOWS.filter(
    (workflow) => workflow.primaryFor === agentKey,
  ).map((workflow) => ({ id: workflow.id, name: workflow.name }));
}

/** The agent-turn binding id: `agent:` + a registry key or user-agent id. */
export function agentWorkflowId(agentKeyOrId: string): string {
  return `${AGENT_WORKFLOW_PREFIX}${agentKeyOrId}`;
}

export type ParsedWorkflowId =
  | { kind: 'code'; source: CodeWorkflowSource }
  | { kind: 'builtin-agent'; agentKey: string }
  | { kind: 'user-agent'; agentId: string };

/**
 * What a session's workflow id names: a code workflow, or the agent-turn
 * binding of a wrapped built-in agent or a user agent. Undefined for an
 * unknown id (a removed workflow such as `seq-text-demo` or
 * `deep-analysis`), a System agent's key and the `primaryFor` agent of a
 * code workflow (it runs that workflow). Any other `agent:` id names a user
 * agent. Only `GET /workflows` says what the catalogue holds.
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
 * The tool-loop budget of an agent-turn binding's agent: 10 for the Data
 * Readiness Agent, 15 for the assistant and user agents.
 */
export function wrappedAgentMaxSteps(agentKeyOrId: string): number {
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
