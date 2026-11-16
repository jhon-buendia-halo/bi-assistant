/**
 * The workflow catalogue (ADR-0040; agents.md 5.12): the workflows defined in
 * code (only Insights Analyst, `answer-business-question`, since 1.23.35), and the
 * turn routing of the agent-turn engine: the `agent:<key>` ids a run host, a
 * draft run or a stored session is bound to, and the rule that derives a
 * session's workflow from its stored agent binding. An `agent:` id names the
 * engine an agent turn runs on, never a catalogue workflow: `GET /workflows`
 * lists none. Plain data and pure functions, no framework import, so the
 * sessions and agents services and Jest can read it without loading Mastra.
 * The API's catalogue is built from it by `WorkflowsService`.
 */
import {
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  ASSISTANT_MAX_STEPS,
  DASHBOARD_READER_AGENT_KEY,
  DATA_MAPPER_AGENT_KEY,
  DATA_READINESS_AGENT_KEY,
  DATA_READINESS_MAX_STEPS,
  IMAGE_READER_AGENT_KEY,
  SYSTEM_AGENT_KEYS,
} from '../agent-constants';
import {
  INSIGHTS_ANALYST_AGENT_KEY,
  INSIGHTS_ANALYST_DESCRIPTION,
} from '../agents/insights-analyst-catalog';
import { AGENT_TURN_STEPS } from './agent-turn.steps';
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
  MAP_DASHBOARD_DATA_DEFAULT_QUESTION,
  MAP_DASHBOARD_DATA_DESCRIPTION,
  MAP_DASHBOARD_DATA_EDGES,
  MAP_DASHBOARD_DATA_STEPS,
  MAP_DASHBOARD_DATA_WORKFLOW_ID,
  MAP_DASHBOARD_DATA_WORKFLOW_NAME,
} from './map-dashboard-data.steps';
import {
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
  RECREATE_DASHBOARD_DESCRIPTION,
  RECREATE_DASHBOARD_EDGES,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  RECREATE_DASHBOARD_WORKFLOW_NAME,
} from './recreate-dashboard.steps';
import {
  ANSWER_BUSINESS_QUESTION_EDGES,
  ANSWER_BUSINESS_QUESTION_STEPS,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_NAME,
  type ContractStepEntry,
} from './answer-business-question.steps';
import {
  assertWorkflowContracts,
  contractHash,
  type WorkflowEdge,
} from './workflow-contract';
import {
  IMAGES_MAX_COUNT,
  type WorkflowInputField,
  type WorkflowInputValue,
  type WorkflowInputValues,
} from './workflow-input';
import { READ_IMAGES_STEP_ID } from './read-images.steps';

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
/**
 * A run's reference images (workflows R35; api.md 116): up to
 * `IMAGES_MAX_COUNT` PNG, JPEG or WebP images that Read images describes
 * for the later steps (agents.md 2.15). Right after the question in every
 * workflow that has Read images; `max` is the most images.
 */
const IMAGES_FIELD: WorkflowInputField = {
  name: 'images',
  label: 'Reference images',
  type: 'images',
  required: false,
  max: IMAGES_MAX_COUNT,
  help: `Paste, drop or attach up to ${IMAGES_MAX_COUNT} PNG, JPEG or WebP images, 5 MB each.`,
};
const CAREFUL_FIELD: WorkflowInputField = {
  name: 'careful',
  label: 'Careful: cross-check the result with an independent query',
  type: 'boolean',
  required: false,
  default: false,
};

/**
 * Answer a Business Question's optional data-quality check (agents.md
 * 5.11): the branch to Check data quality, where Sarah reviews the tables
 * the analysis read. Off unless ticked.
 */
const CHECK_DATA_QUALITY_FIELD: WorkflowInputField = {
  name: 'checkDataQuality',
  label: 'Check data quality: Sarah reviews the tables the analysis used',
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
      id: ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
      name: ANSWER_BUSINESS_QUESTION_WORKFLOW_NAME,
      description: INSIGHTS_ANALYST_DESCRIPTION,
      primaryFor: INSIGHTS_ANALYST_AGENT_KEY,
      trigger: 'run',
      input: [
        { ...QUESTION_FIELD, maxLength: QUESTION_MAX_LENGTH },
        IMAGES_FIELD,
        DATASETS_FIELD,
        CHECK_DATA_QUALITY_FIELD,
      ],
      steps: ANSWER_BUSINESS_QUESTION_STEPS,
      // Zoe reads the reference images when there are some; Olivia plans
      // and Jessica writes the answer; Michael analyses; Sarah checks the
      // data quality when the run asks for it.
      stepAgents: {
        [READ_IMAGES_STEP_ID]: IMAGE_READER_AGENT_KEY,
        plan: ANALYSIS_PLANNER_AGENT_KEY,
        'check-data-quality': DATA_READINESS_AGENT_KEY,
        'write-answer': ANSWER_WRITER_AGENT_KEY,
      },
      edges: ANSWER_BUSINESS_QUESTION_EDGES,
      bar: 'steps',
    },
    {
      id: DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
      name: DATA_READINESS_ASSESSMENT_WORKFLOW_NAME,
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
        IMAGES_FIELD,
      ],
      steps: DATA_READINESS_ASSESSMENT_STEPS,
      // Zoe reads the reference images when there are some.
      stepAgents: { [READ_IMAGES_STEP_ID]: IMAGE_READER_AGENT_KEY },
      edges: DATA_READINESS_ASSESSMENT_EDGES,
      bar: 'steps',
    },
    {
      id: RECREATE_DASHBOARD_WORKFLOW_ID,
      name: RECREATE_DASHBOARD_WORKFLOW_NAME,
      description: RECREATE_DASHBOARD_DESCRIPTION,
      // Grace reads the dashboard.
      primaryFor: DASHBOARD_READER_AGENT_KEY,
      trigger: 'run',
      input: [
        {
          name: 'image',
          label: 'Dashboard image',
          type: 'image',
          required: true,
          help: 'A PNG, JPEG or WebP screenshot of the dashboard, up to 5 MB.',
        },
        {
          name: 'question',
          label: 'Instructions',
          type: 'textarea',
          required: false,
          placeholder: RECREATE_DASHBOARD_DEFAULT_QUESTION,
          default: RECREATE_DASHBOARD_DEFAULT_QUESTION,
          maxLength: QUESTION_MAX_LENGTH,
        },
      ],
      steps: RECREATE_DASHBOARD_STEPS,
      edges: RECREATE_DASHBOARD_EDGES,
      bar: 'steps',
    },
    {
      id: MAP_DASHBOARD_DATA_WORKFLOW_ID,
      name: MAP_DASHBOARD_DATA_WORKFLOW_NAME,
      description: MAP_DASHBOARD_DATA_DESCRIPTION,
      // Daniel maps the saved dashboard to the datasets.
      primaryFor: DATA_MAPPER_AGENT_KEY,
      trigger: 'run',
      input: [
        {
          name: 'artifact',
          label: 'Saved dashboard',
          type: 'artifact',
          required: true,
          artifactKinds: ['dashboard'],
          help: 'A dashboard saved in Artifacts by Dashboard Image to Artifact.',
        },
        { ...DATASETS_FIELD, help: 'The data the dashboard is mapped to.' },
        {
          name: 'question',
          label: 'Instructions',
          type: 'textarea',
          required: false,
          placeholder: MAP_DASHBOARD_DATA_DEFAULT_QUESTION,
          default: MAP_DASHBOARD_DATA_DEFAULT_QUESTION,
          maxLength: QUESTION_MAX_LENGTH,
        },
        IMAGES_FIELD,
      ],
      steps: MAP_DASHBOARD_DATA_STEPS,
      // Zoe reads the reference images when there are some.
      stepAgents: { [READ_IMAGES_STEP_ID]: IMAGE_READER_AGENT_KEY },
      edges: MAP_DASHBOARD_DATA_EDGES,
      bar: 'steps',
    },
  ]).map((workflow) => ({ ...workflow, contractHash: contractHash(workflow) }));

/** What one agent turn of a run takes from the run's input (plan 4.2, 5.1). */
export interface AgentRunTurn {
  /** The user message: `question`, trimmed. */
  question: string;
  /** `datasets`, or the readiness run's one `dataset`; absent otherwise. */
  datasets?: string[];
  /** Careful mode (the Assistant and user agents). */
  careful: boolean;
  /** Answer a Business Question's `checkDataQuality`: Check data quality runs. */
  checkDataQuality?: true;
  /** Map a Dashboard to Data's `artifact`: the saved dashboard it maps. */
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
    ...(values['checkDataQuality'] === true
      ? { checkDataQuality: true as const }
      : {}),
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
 * detail lists them (api.md 34 `usedInWorkflows`): `answer-business-question` for
 * `insights-analyst`, `analysis-planner` and `answer-writer`, none for any
 * other agent.
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
    // A wrapped agent's own turn first: the Data Readiness Agent also runs
    // a code workflow's step, but its sessions and the eval runner's host
    // stay on its agent turn (a run host names its workflow itself).
    if (WRAPPED_AGENT_KEYS.includes(session.agentKey)) {
      return agentWorkflowId(session.agentKey);
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
