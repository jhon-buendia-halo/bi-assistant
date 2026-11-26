/**
 * The workflow catalogue (ADR-0040; agents.md 5.12): the workflows defined in
 * code, the ids of the removed ones a past chat or stored run may still
 * name, and the turn routing of the agent-turn engine: the `agent:<key>` ids a run host, a
 * draft run or a stored session is bound to, and the rule that derives a
 * session's workflow from its stored agent binding. An `agent:` id names the
 * engine an agent turn runs on, never a catalogue workflow: `GET /workflows`
 * lists none. Plain data and pure functions, no framework import, so the
 * sessions and agents services and Jest can read it without loading Mastra.
 * The API's catalogue is built from it by `WorkflowsService`.
 */
import {
  CHIEF_OF_STAFF_AGENT_KEY,
  ASSISTANT_MAX_STEPS,
  DATA_READINESS_AGENT_KEY,
  DATA_READINESS_MAX_STEPS,
  GAP_ADVISOR_AGENT_KEY,
  LAYER_MAPPER_AGENT_KEY,
  REQUIREMENTS_ANALYST_AGENT_KEY,
  SYSTEM_AGENT_KEYS,
} from '../agent-constants';
import { INSIGHTS_ANALYST_AGENT_KEY } from '../agents/insights-analyst-catalog';
import { INSIGHTS_LEAD_AGENT_KEY } from '../agents/insights-lead-catalog';
import {
  INSIGHTS_LEAD_EDGES,
  INSIGHTS_LEAD_STEPS,
  INSIGHTS_LEAD_WORKFLOW_ID,
} from './conversation-turn.steps';
import {
  conversationalBindingOf,
  type ConversationalBinding,
} from '../conversational-agents';
import { AGENT_TURN_STEPS } from './agent-turn.steps';
import {
  ORCHESTRATED_MICHAEL_EDGES,
  ORCHESTRATED_MICHAEL_STEPS,
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  ORCHESTRATED_MICHAEL_WORKFLOW_NAME,
} from './orchestrated-answer-michael.steps';
import {
  CONSUMPTION_GAP_DESCRIPTION,
  CONSUMPTION_GAP_EDGES,
  CONSUMPTION_GAP_STEPS,
  CONSUMPTION_GAP_WORKFLOW_ID,
  CONSUMPTION_GAP_WORKFLOW_NAME,
  GAP_MAX_QUESTIONS,
} from './consumption-gap-analysis.steps';
import {
  DATA_READINESS_ASSESSMENT_DESCRIPTION,
  DATA_READINESS_ASSESSMENT_EDGES,
  DATA_READINESS_ASSESSMENT_STEPS,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  DATA_READINESS_ASSESSMENT_WORKFLOW_NAME,
  READINESS_DEFAULT_QUESTION,
} from './data-readiness-assessment.steps';
import type { AgentWorkflow } from './agent-workflows';
import {
  assertWorkflowContracts,
  contractHash,
  type ContractStepEntry,
  type WorkflowEdge,
} from './workflow-contract';
import type {
  WorkflowInputField,
  WorkflowInputValue,
  WorkflowInputValues,
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

/**
 * The categories the Workflows page groups the catalogue by, each with
 * its section heading (workflows R5; api.md 116). Add one here when a
 * workflow needs a new kind of work (Financial, …).
 */
export const WORKFLOW_CATEGORIES = {
  'data-analytics': 'Data Analytics',
  'data-engineering': 'Data Engineering',
  dashboards: 'Dashboards',
  'software-development': 'Software Development',
} as const;

export type WorkflowCategoryId = keyof typeof WORKFLOW_CATEGORIES;

/** A workflow's category as `GET /workflows` lists it (api.md 116). */
export interface WorkflowCategory {
  id: WorkflowCategoryId;
  name: (typeof WORKFLOW_CATEGORIES)[WorkflowCategoryId];
}

export function workflowCategory(id: WorkflowCategoryId): WorkflowCategory {
  return { id, name: WORKFLOW_CATEGORIES[id] };
}

/** The placeholder of a run's question. */
const QUESTION_PLACEHOLDER = 'Ask a question about your data';

/** Consumption Gap Analysis's placeholder: two questions, one per line. */
const CONSUMPTION_GAP_PLACEHOLDER =
  'Which team won the most matches in each World Cup?\nWhat share of the goals were penalties?';

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
  /** The section it is listed under on the Workflows page (workflows R5). */
  category: WorkflowCategoryId;
  /** Registry key of the agent its agent steps run, unless `stepAgents` names another. */
  primaryFor: string;
  /**
   * The agent steps that run an agent of their own, by step id: registry
   * keys (agents.md 5.11). Every other agent step runs `primaryFor`.
   */
  stepAgents?: Readonly<Record<string, string>>;
  trigger: WorkflowTrigger;
  /** The typed input of a run, in form order. */
  input: readonly WorkflowInputField[];
  /** Each with its declared input and output schema (agents.md 5.12). */
  steps: readonly ContractStepEntry[];
  /** How the steps connect, from Start to End (api.md 117). */
  edges: readonly WorkflowEdge[];
  /** `steps` for every code workflow today. */
  bar: WorkflowBar;
  /** The hash of its data contract (api.md 117; `contractHash`). */
  contractHash: string;
}

/** The longest question a run takes, in characters (trimmed). */
export const QUESTION_MAX_LENGTH = 4000;

/**
 * The workflows defined in code, in catalogue order, each with its contract
 * hash. Built through the contract check (workflows R26): a workflow with a
 * step input that neither its input nor an earlier step gives, or gives
 * with an incompatible type or maybe not at all, throws here, so it never
 * loads.
 */
export const CODE_WORKFLOWS: readonly CodeWorkflowSource[] =
  assertWorkflowContracts<Omit<CodeWorkflowSource, 'contractHash'>>([
    {
      // Avery, the Chief of Staff, with Michael (workflows R45; agents.md
      // 5.23): Michael plans, queries and writes the answer, and Avery is
      // the only one who talks to the user. The run host stays Michael's:
      // her answer_from_data runs his turn there.
      id: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
      name: ORCHESTRATED_MICHAEL_WORKFLOW_NAME,
      category: 'data-analytics',
      description:
        'The same question answered by Avery, the Chief of Staff, with Michael alone: he plans, queries the data and writes the answer; she briefs him, checks it and is the only one you talk to.',
      primaryFor: INSIGHTS_ANALYST_AGENT_KEY,
      trigger: 'run',
      input: [
        { ...QUESTION_FIELD, maxLength: QUESTION_MAX_LENGTH },
        DATASETS_FIELD,
      ],
      steps: ORCHESTRATED_MICHAEL_STEPS,
      stepAgents: { orchestrate: CHIEF_OF_STAFF_AGENT_KEY },
      edges: ORCHESTRATED_MICHAEL_EDGES,
      bar: 'steps',
    },
    {
      id: DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
      name: DATA_READINESS_ASSESSMENT_WORKFLOW_NAME,
      category: 'data-engineering',
      description: DATA_READINESS_ASSESSMENT_DESCRIPTION,
      // Its Explain report step runs the Data Readiness Agent.
      primaryFor: DATA_READINESS_AGENT_KEY,
      trigger: 'run',
      input: [
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
          maxLength: QUESTION_MAX_LENGTH,
        },
      ],
      steps: DATA_READINESS_ASSESSMENT_STEPS,
      edges: DATA_READINESS_ASSESSMENT_EDGES,
      bar: 'steps',
    },
    {
      id: CONSUMPTION_GAP_WORKFLOW_ID,
      name: CONSUMPTION_GAP_WORKFLOW_NAME,
      category: 'data-engineering',
      description: CONSUMPTION_GAP_DESCRIPTION,
      // The Gap Advisor recommends the fixes (agents.md 2.20, 5.20).
      primaryFor: GAP_ADVISOR_AGENT_KEY,
      trigger: 'run',
      input: [
        {
          ...DATASETS_FIELD,
          help: 'Datasets whose schemas are tagged Landing, Normalized and Consumption.',
        },
        {
          name: 'question',
          label: 'Business questions',
          type: 'textarea',
          required: true,
          placeholder: CONSUMPTION_GAP_PLACEHOLDER,
          help: `One question per line, up to ${GAP_MAX_QUESTIONS}.`,
          maxLength: QUESTION_MAX_LENGTH,
        },
        {
          name: 'artifact',
          label: 'Saved dashboard',
          type: 'artifact',
          required: false,
          artifactKinds: ['dashboard'],
        },
      ],
      steps: CONSUMPTION_GAP_STEPS,
      // The Requirements Analyst derives the requirements and the Layer
      // Mapper maps them; the Gap Advisor (`primaryFor`) recommends the
      // fixes.
      stepAgents: {
        'derive-requirements': REQUIREMENTS_ANALYST_AGENT_KEY,
        'map-requirements': LAYER_MAPPER_AGENT_KEY,
      },
      edges: CONSUMPTION_GAP_EDGES,
      bar: 'steps',
    },
  ]).map((workflow) => ({ ...workflow, contractHash: contractHash(workflow) }));

/** The name of Elena's conversation as a run shows it (api.md 117, 120). */
export const INSIGHTS_LEAD_WORKFLOW_NAME = 'Conversation with Elena';

/**
 * The built-in agents' conversations outside any workflow (plan Elena 1.1),
 * as `GET /workflows/:id` (117) and the run routes (118, 119) resolve them:
 * Elena's `agent:insights-lead`, one Answer step on her own. Never in
 * `CODE_WORKFLOWS`, so `GET /workflows` (116) never lists one.
 */
export const CONVERSATION_WORKFLOWS: readonly CodeWorkflowSource[] =
  assertWorkflowContracts<Omit<CodeWorkflowSource, 'contractHash'>>([
    {
      id: INSIGHTS_LEAD_WORKFLOW_ID,
      name: INSIGHTS_LEAD_WORKFLOW_NAME,
      category: 'data-analytics',
      description:
        'A conversation with Elena, the Insights Lead: she queries your data, checks every figure and writes the answer on her own, and builds a dashboard or exports the conversation when you ask.',
      primaryFor: INSIGHTS_LEAD_AGENT_KEY,
      trigger: 'run',
      input: [
        { ...QUESTION_FIELD, maxLength: QUESTION_MAX_LENGTH },
        DATASETS_FIELD,
      ],
      steps: INSIGHTS_LEAD_STEPS,
      edges: INSIGHTS_LEAD_EDGES,
      bar: 'steps',
    },
  ]).map((workflow) => ({ ...workflow, contractHash: contractHash(workflow) }));

/**
 * The code workflows removed from the catalogue (data-model 3.16 M18): their
 * stored runs are deleted at startup, and a past chat that ran one keeps its
 * id, so its chip still names it (`REMOVED_WORKFLOW_NAMES`). Never listed,
 * never run: a past chat of one goes on as its agent's own turn, or as the
 * plain assistant's when its agent is gone too.
 */
export const REMOVED_WORKFLOW_IDS: readonly string[] = [
  'answer-business-question',
  'orchestrated-answer',
  'recreate-dashboard',
  'map-dashboard-data',
  'review-website',
];

/** The name a removed workflow had, by id, for a past chat's chip. */
export const REMOVED_WORKFLOW_NAMES: Readonly<Record<string, string>> = {
  'answer-business-question': 'Answer a Business Question',
  'orchestrated-answer': 'Answer a Business Question (orchestrated)',
  'recreate-dashboard': 'Dashboard Image to Artifact',
  'map-dashboard-data': 'Map a Dashboard to Data',
  'review-website': 'Review a Website',
};

/** Whether an id names a removed code workflow (`REMOVED_WORKFLOW_IDS`). */
export function isRemovedWorkflowId(id: string | undefined): boolean {
  return !!id && REMOVED_WORKFLOW_IDS.includes(id);
}

/** What one agent turn of a run takes from the run's input (plan 4.2, 5.1). */
export interface AgentRunTurn {
  /** The user message: `question`, trimmed. */
  question: string;
  /** `datasets`, or the readiness run's one `dataset`; absent otherwise. */
  datasets?: string[];
  /** Careful mode (the Assistant and user agents). */
  careful: boolean;
  /** Consumption Gap Analysis's `artifact`: the saved dashboard it reads. */
  artifact?: string;
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
    ...(text(values['artifact']) ? { artifact: text(values['artifact']) } : {}),
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
 * The catalogue workflows whose agent steps run an agent, as an agent's
 * detail lists them (api.md 34 `usedInWorkflows`): Answer a Business
 * Question (Avery + Michael) for `insights-analyst` and `chief-of-staff`.
 */
export function workflowsUsingAgent(
  agentKey: string,
): { id: string; name: string }[] {
  return CODE_WORKFLOWS.filter((workflow) =>
    workflowAgentKeys(workflow).includes(agentKey),
  ).map((workflow) => ({ id: workflow.id, name: workflow.name }));
}

/**
 * The registry keys of the agents a code workflow's steps run, in step
 * order without repeats: its `primaryFor` agent first, then its step agents.
 */
export function workflowAgentKeys(
  workflow: Pick<CodeWorkflowSource, 'primaryFor' | 'steps' | 'stepAgents'>,
): string[] {
  const keys = [workflow.primaryFor];
  for (const step of workflow.steps) {
    if (step.kind !== 'agent') continue;
    const key = stepAgentKey(workflow, step.id);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The registry key of the agent a code workflow's agent step runs. */
export function stepAgentKey(
  workflow: Pick<CodeWorkflowSource, 'primaryFor' | 'stepAgents'>,
  stepId: string,
): string {
  return workflow.stepAgents && Object.hasOwn(workflow.stepAgents, stepId)
    ? workflow.stepAgents[stepId]
    : workflow.primaryFor;
}

/** The agent-turn binding id: `agent:` + a registry key or user-agent id. */
export function agentWorkflowId(agentKeyOrId: string): string {
  return `${AGENT_WORKFLOW_PREFIX}${agentKeyOrId}`;
}

export type ParsedWorkflowId =
  | { kind: 'code'; source: CodeWorkflowSource }
  | { kind: 'builtin-agent'; agentKey: string }
  | { kind: 'conversation'; binding: ConversationalBinding }
  | { kind: 'user-agent'; agentId: string };

/**
 * What a session's workflow id names: a code workflow, a built-in agent's
 * conversation outside any workflow (`agent:insights-lead`, plan Elena
 * 1.3; Avery's conversational workflow stays a code workflow), or the
 * agent-turn binding of a wrapped built-in agent or a user agent. Undefined for an
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
  const binding = conversationalBindingOf(id);
  if (binding) return { kind: 'conversation', binding };
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
 * still resolves or names a removed workflow (a past chat keeps it), else
 * the one its agent fields derive: `answer-business-question`, removed, for
 * Michael's past chats (they ran it before a session stored its workflow),
 * the code workflow whose `primaryFor` is its `agentKey`, `agent:<agentKey>`
 * for a wrapped built-in agent, `agent:<agentId>` for a user agent (deleted
 * or not), and `agent:assistant` otherwise.
 */
export function sessionWorkflowId(session: SessionWorkflowFields): string {
  if (
    session.workflowId &&
    (parseWorkflowId(session.workflowId) ||
      isRemovedWorkflowId(session.workflowId))
  ) {
    return session.workflowId;
  }
  if (session.agentKey) {
    // A wrapped agent's own turn first: the Data Readiness Agent also runs
    // a code workflow's step, but its sessions and the eval runner's host
    // stay on its agent turn (a run host names its workflow itself).
    if (WRAPPED_AGENT_KEYS.includes(session.agentKey)) {
      return agentWorkflowId(session.agentKey);
    }
    // Michael's past chats ran Answer a Business Question: they keep it.
    if (session.agentKey === INSIGHTS_ANALYST_AGENT_KEY) {
      return REMOVED_WORKFLOW_IDS[0];
    }
    const code = CODE_WORKFLOWS.find(
      (workflow) => workflow.primaryFor === session.agentKey,
    );
    if (code) return code.id;
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
 * `agent`, with an `it asks you a question` exit when the agent can ask one.
 */
export function oneStepWorkflowSteps(agent: {
  /** The agent's registry key or user-agent id. */
  key: string;
  name: string;
  /** The agent's job title; '' when it has none. */
  role?: string;
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
      key: agent.key,
      name: agent.name,
      role: agent.role ?? '',
      tools: [...agent.tools],
      maxSteps: agent.maxSteps,
    },
    exits: [
      ...step.exits.map((exit) => ({ ...exit })),
      ...(agent.tools.includes(CLARIFICATION_TOOL)
        ? [{ label: 'it asks you a question', outcome: 'stops' as const }]
        : []),
    ],
  }));
}
