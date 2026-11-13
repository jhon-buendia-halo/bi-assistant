import { RunView } from '../models/workflow.model';
import { GRAPH_WORKFLOW } from './workflow-graph.testing';
import {
  activityLine,
  elapsedLabel,
  progressSteps,
} from './workflow-run-progress';

const W = {
  steps: GRAPH_WORKFLOW.steps,
  edges: [
    { from: 'start', to: 'receive-question', kind: 'next' as const },
    { from: 'receive-question', to: 'load-catalog', kind: 'next' as const },
    { from: 'load-catalog', to: 'plan', kind: 'next' as const },
    { from: 'plan', to: 'clarify', kind: 'branch' as const, label: 'Needs clarification' },
    { from: 'clarify', to: 'plan', kind: 'loop' as const, label: 'Answered' },
    { from: 'plan', to: 'analyse', kind: 'branch' as const, label: 'Clear' },
    { from: 'analyse', to: 'validate', kind: 'next' as const },
    { from: 'validate', to: 'analyse', kind: 'loop' as const },
    { from: 'validate', to: 'write-answer', kind: 'next' as const },
    { from: 'write-answer', to: 'wrap-up', kind: 'next' as const },
    { from: 'wrap-up', to: 'end', kind: 'next' as const },
  ],
};

function run(
  status: RunView['status'],
  steps: {
    id: string;
    status: RunView['steps'][number]['status'];
    startedAt?: string;
  }[],
): RunView {
  return {
    status,
    steps: steps.map((s) => ({
      id: s.id,
      title: s.id,
      kind: 'code' as const,
      status: s.status,
      ...(s.startedAt ? { startedAt: s.startedAt } : {}),
    })),
  };
}

describe('progressSteps (ui.md 4.4b run progress)', () => {
  it('lists the steps in path order, Clarify only when it ran', () => {
    const none = progressSteps(W, run('running', []));
    expect(none.map((s) => s.id)).toEqual([
      'receive-question',
      'load-catalog',
      'plan',
      'analyse',
      'validate',
      'write-answer',
      'wrap-up',
    ]);
    expect(none.every((s) => s.state === 'pending')).toBeTrue();
    const asked = progressSteps(
      W,
      run('suspended', [
        { id: 'plan', status: 'success' },
        { id: 'clarify', status: 'suspended' },
      ]),
    );
    expect(asked.map((s) => s.id).slice(2, 5)).toEqual([
      'plan',
      'clarify',
      'analyse',
    ]);
  });

  it('maps each step to done, current, waiting, failed, skipped and pending', () => {
    const steps = progressSteps(
      W,
      run('running', [
        { id: 'receive-question', status: 'success' },
        { id: 'load-catalog', status: 'success' },
        { id: 'plan', status: 'skipped' },
        {
          id: 'analyse',
          status: 'running',
          startedAt: '2026-11-11T10:00:00.000Z',
        },
      ]),
    );
    const state = (id: string) => steps.find((s) => s.id === id)?.state;
    expect(state('receive-question')).toBe('done');
    expect(state('plan')).toBe('skipped');
    expect(state('analyse')).toBe('current');
    expect(steps.find((s) => s.id === 'analyse')?.startedAt).toBe(
      '2026-11-11T10:00:00.000Z',
    );
    expect(state('validate')).toBe('pending');
    const failed = progressSteps(
      W,
      run('failed', [{ id: 'plan', status: 'failed' }]),
    );
    expect(failed.find((s) => s.id === 'plan')?.state).toBe('failed');
    const waiting = progressSteps(
      W,
      run('suspended', [{ id: 'analyse', status: 'suspended' }]),
    );
    expect(waiting.find((s) => s.id === 'analyse')?.state).toBe('waiting');
  });

  it('shows a step that ran twice once, as its last attempt, with the count', () => {
    const steps = progressSteps(
      W,
      run('running', [
        { id: 'plan', status: 'success' },
        { id: 'plan', status: 'running' },
      ]),
    );
    const plan = steps.find((s) => s.id === 'plan');
    expect(plan?.attempts).toBe(2);
    expect(plan?.state).toBe('current');
  });

  it('falls back to the list order for a workflow without edges', () => {
    const steps = progressSteps({ steps: GRAPH_WORKFLOW.steps }, null);
    expect(steps.map((s) => s.id)).toEqual(
      GRAPH_WORKFLOW.steps.map((s) => s.id),
    );
  });
});

describe('activityLine (ui.md 4.4b activity copy)', () => {
  const on = (id: string) =>
    progressSteps(W, run('running', [{ id, status: 'running' }]));

  it('says what the current step is doing', () => {
    expect(activityLine(on('plan'), 'running', [])).toBe(
      'Planning the analysis…',
    );
    expect(activityLine(on('validate'), 'running', [])).toBe(
      'Checking the results…',
    );
    expect(activityLine(on('write-answer'), 'running', [])).toBe(
      'Writing the answer…',
    );
  });

  it('Analyse uses the latest tool rationale, else Analysing…', () => {
    expect(activityLine(on('analyse'), 'running', [])).toBe('Analysing…');
    const calls = [
      { name: 'a', rationale: 'Counting matches', finished: true },
      { name: 'b', finished: false },
      { name: 'c', rationale: ' Joining teams ', finished: false },
      { name: 'd', finished: false },
    ];
    expect(activityLine(on('analyse'), 'running', calls)).toBe(
      'Analyse · Joining teams',
    );
  });

  it('waits for the answer while suspended and is silent once the run ended', () => {
    expect(activityLine([], 'suspended', [])).toBe('Waiting for your answer');
    expect(activityLine(on('plan'), 'success', [])).toBeNull();
    expect(activityLine(on('plan'), 'failed', [])).toBeNull();
  });
});

describe('elapsedLabel', () => {
  it('reads whole seconds and minutes', () => {
    const t = new Date('2026-11-11T10:00:00.000Z').getTime();
    expect(elapsedLabel('2026-11-11T10:00:00.000Z', t + 4_900)).toBe('4 s');
    expect(elapsedLabel('2026-11-11T10:00:00.000Z', t + 64_000)).toBe(
      '1 min 4 s',
    );
    expect(elapsedLabel('2026-11-11T10:00:00.000Z', t - 5_000)).toBe('0 s');
  });
});
