import { WorkflowDetail } from '../../models/workflow.model';
import {
  NodeInspection,
  WorkflowStateSummary,
} from '../../models/workflow-node.model';

/** Fixtures for the node dialog and Workflow state panel specs. */
export const FIXTURE_WORKFLOW: WorkflowDetail = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Answers a question over the datasets.',
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'qti', name: 'Questions to Insights v2' }],
  stepCount: 2,
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'text', required: true },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: false },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    {
      id: 'receive',
      title: 'Receive question',
      kind: 'code',
      summary: 'Checks the question.',
      input: ['question'],
      output: ['question', 'catalog'],
      exits: [{ label: 'Empty question', outcome: 'fails' }],
    },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary: 'Runs the agent.',
      input: ['question', 'catalog'],
      output: ['calls', 'stopped'],
      agent: {
        name: 'Questions to Insights v2',
        tools: ['list_entities', 'run_readonly_sql'],
        maxSteps: 15,
        key: 'qti',
      },
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
      ],
    },
  ],
};

const AGENT = {
  key: 'qti',
  name: 'Questions to Insights v2',
  model: 'anthropic/claude-sonnet-5-5',
  systemPrompt: 'You are a data analyst.',
};

export const FIXTURE_NODES: NodeInspection[] = [
  {
    nodeId: 'start',
    kind: 'trigger',
    title: 'Start',
    number: null,
    summary: 'Answers a question over the datasets.',
    step: null,
    agent: null,
    run: {
      status: 'success',
      output: { question: 'Top 5 states?' },
      durationMs: null,
      toolCalls: [],
    },
    context: null,
  },
  {
    nodeId: 'receive',
    kind: 'code',
    title: 'Receive question',
    number: 1,
    summary: 'Checks the question.',
    step: FIXTURE_WORKFLOW.steps[0],
    agent: null,
    run: {
      status: 'success',
      input: { question: 'Top 5 states?' },
      output: {
        question: 'Top 5 states?',
        catalog: [{ entity: 'claims', rows: 3 }],
      },
      durationMs: 2,
      toolCalls: [],
    },
    context: {
      workflowInput: { question: 'Top 5 states?' },
      earlierSteps: [],
      agent: null,
    },
  },
  {
    nodeId: 'analyse',
    kind: 'agent',
    title: 'Analyse',
    number: 2,
    summary: 'Runs the agent.',
    step: FIXTURE_WORKFLOW.steps[1],
    agent: AGENT,
    run: {
      status: 'success',
      input: { question: 'Top 5 states?' },
      output: { calls: 3, stopped: false },
      durationMs: 13_900,
      toolCalls: [
        { tool: 'list_entities', durationMs: 200, finished: true },
        {
          tool: 'run_readonly_sql',
          input: 'SELECT state FROM claims',
          rowCount: 5,
          durationMs: 1100,
          finished: true,
        },
        { tool: 'describe_entity', error: 'No such entity', finished: true },
      ],
    },
    context: {
      workflowInput: { question: 'Top 5 states?' },
      earlierSteps: [
        { id: 'receive', title: 'Receive question', status: 'success' },
      ],
      agent: {
        key: 'qti',
        name: 'Questions to Insights v2',
        model: 'anthropic/claude-sonnet-5-5',
        tools: ['list_entities', 'run_readonly_sql'],
      },
    },
  },
  {
    nodeId: 'end',
    kind: 'output',
    title: 'End',
    number: null,
    summary: '',
    step: null,
    agent: null,
    run: {
      status: 'success',
      input: { calls: 3, stopped: false },
      output: { answer: 'California leads.' },
      durationMs: null,
      toolCalls: [],
    },
    context: null,
  },
];

/** The same nodes before any run. */
export const FIXTURE_NODES_NOT_RUN: NodeInspection[] = FIXTURE_NODES.map(
  (n) => ({
    ...n,
    run: null,
  }),
);

export const FIXTURE_SUMMARY: WorkflowStateSummary = {
  status: 'success',
  ran: 4,
  total: 4,
  durationMs: 14_000,
  runId: 'run_8f21c4',
};
