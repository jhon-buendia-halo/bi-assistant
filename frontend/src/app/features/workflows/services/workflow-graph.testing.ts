import {
  PlanOutput,
  RunView,
  ValidateOutput,
  WorkflowDetail,
  WorkflowDetailStep,
} from '../models/workflow.model';

/**
 * Fixtures for the analyst workflow's graph (Questions to Insights v2,
 * phase 2): a branch after Plan (Clarify ends the run) and a loop from
 * Validate back to Analyse. Shared by the layout, inspection, canvas,
 * dialog and Workflow state specs.
 */

function code(
  id: string,
  title: string,
  input: string[],
  output: string[],
): WorkflowDetailStep {
  return {
    id,
    title,
    kind: 'code',
    summary: `${title}.`,
    input,
    output,
    exits: [],
  };
}

function agent(
  id: string,
  title: string,
  input: string[],
  output: string[],
  tools: string[],
): WorkflowDetailStep {
  return {
    id,
    title,
    kind: 'agent',
    summary: `${title}.`,
    input,
    output,
    agent: {
      key: 'qti',
      name: 'Michael',
      role: 'Insights Analyst',
      tools,
      maxSteps: 15,
    },
    exits: [],
  };
}

export const GRAPH_WORKFLOW: WorkflowDetail = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Answers a question over the datasets.',
  kind: 'code',
  owner: 'Official',
  agents: [
    { key: 'qti', name: 'Questions to Insights v2', model: 'openai/gpt-5' },
  ],
  stepCount: 8,
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    code('receive-question', 'Receive question', ['question'], ['question']),
    code('load-catalog', 'Load catalog', ['question'], ['question', 'catalog']),
    agent('plan', 'Plan', ['question', 'catalog'], ['plan'], []),
    code('clarify', 'Clarify', ['plan'], ['clarification']),
    agent(
      'analyse',
      'Analyse',
      ['plan'],
      ['calls', 'queries', 'stopped'],
      ['run_readonly_sql'],
    ),
    code(
      'validate',
      'Validate',
      ['calls', 'queries'],
      ['ok', 'attempt', 'findings'],
    ),
    agent(
      'write-answer',
      'Write answer',
      ['plan', 'queries', 'findings'],
      ['headline', 'answer'],
      [],
    ),
    code('wrap-up', 'Wrap up', ['answer'], ['answer']),
  ],
  edges: [
    { from: 'start', to: 'receive-question', kind: 'next' },
    { from: 'receive-question', to: 'load-catalog', kind: 'next' },
    { from: 'load-catalog', to: 'plan', kind: 'next' },
    {
      from: 'plan',
      to: 'clarify',
      kind: 'branch',
      label: 'Needs clarification',
    },
    { from: 'plan', to: 'analyse', kind: 'branch', label: 'Clear' },
    { from: 'analyse', to: 'validate', kind: 'next' },
    { from: 'validate', to: 'analyse', kind: 'loop', label: 'Retry once' },
    {
      from: 'validate',
      to: 'write-answer',
      kind: 'next',
      label: 'Valid or retried',
    },
    { from: 'write-answer', to: 'wrap-up', kind: 'next' },
    { from: 'wrap-up', to: 'end', kind: 'next' },
    { from: 'clarify', to: 'end', kind: 'next' },
  ],
};

export const GRAPH_PLAN: PlanOutput = {
  question: 'How many matches per stage?',
  measures: ['match count'],
  entities: ['matches', 'stages'],
  scope: 'All tournaments',
  assumptions: ['A replayed match counts once'],
  needsClarification: false,
  clarification: null,
};

export const GRAPH_VALIDATE_FAILED: ValidateOutput = {
  ok: false,
  attempt: 1,
  findings: [
    {
      check: 'A query succeeded',
      passed: false,
      detail: 'No query returned rows.',
    },
    { check: 'No tool error left', passed: true, detail: 'None.' },
  ],
};

export const GRAPH_VALIDATE_OK: ValidateOutput = {
  ok: true,
  attempt: 2,
  findings: [
    {
      check: 'A query succeeded',
      passed: true,
      detail: '1 query returned rows.',
    },
    { check: 'No tool error left', passed: true, detail: 'None.' },
  ],
};

const T = (s: number) => `2026-11-13T10:00:${String(s).padStart(2, '0')}.000Z`;

/** A stored run that retried Analyse and Validate once; Clarify was skipped. */
export const GRAPH_RETRY_RUN: RunView = {
  status: 'success',
  runId: 'run-retry',
  input: { question: 'How many matches per stage?' },
  startedAt: T(0),
  finishedAt: T(30),
  output: { answer: 'There were 64 matches.' },
  steps: [
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      status: 'success',
      startedAt: T(0),
      endedAt: T(1),
    },
    {
      id: 'load-catalog',
      title: 'Load catalog',
      kind: 'code',
      status: 'success',
      startedAt: T(1),
      endedAt: T(2),
    },
    {
      id: 'plan',
      title: 'Plan',
      kind: 'agent',
      status: 'success',
      // As the backend passes it on: the question and catalog beside the plan.
      output: { question: GRAPH_PLAN.question, catalog: [], plan: { ...GRAPH_PLAN } },
      startedAt: T(2),
      endedAt: T(4),
    },
    { id: 'clarify', title: 'Clarify', kind: 'code', status: 'skipped' },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      status: 'success',
      attempt: 1,
      input: { plan: 'first' },
      output: { stopped: false, plan: { ...GRAPH_PLAN } },
      startedAt: T(4),
      endedAt: T(10),
      toolCalls: [
        { tool: 'run_readonly_sql', input: 'select 1', error: 'boom' },
      ],
    },
    {
      id: 'validate',
      title: 'Validate',
      kind: 'code',
      status: 'success',
      attempt: 1,
      output: { ...GRAPH_VALIDATE_FAILED, plan: { ...GRAPH_PLAN }, queries: [] },
      startedAt: T(10),
      endedAt: T(11),
    },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      status: 'success',
      attempt: 2,
      input: { plan: 'second' },
      output: { stopped: false, plan: { ...GRAPH_PLAN } },
      startedAt: T(11),
      endedAt: T(20),
      toolCalls: [{ tool: 'run_readonly_sql', input: 'select 2', rowCount: 3 }],
    },
    {
      id: 'validate',
      title: 'Validate',
      kind: 'code',
      status: 'success',
      attempt: 2,
      output: { ...GRAPH_VALIDATE_OK, plan: { ...GRAPH_PLAN }, queries: [] },
      startedAt: T(20),
      endedAt: T(21),
    },
    {
      id: 'write-answer',
      title: 'Write answer',
      kind: 'agent',
      status: 'success',
      output: {
        headline: 'There were 64 matches.',
        answer: 'There were 64 matches.',
      },
      startedAt: T(21),
      endedAt: T(29),
    },
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      status: 'success',
      output: { answer: 'There were 64 matches.' },
      startedAt: T(29),
      endedAt: T(30),
    },
  ],
};
