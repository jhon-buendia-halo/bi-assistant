import {
  stepEventOf,
  workflowRunState,
  workflowStepPhases,
  type WorkflowStepEvent,
} from './workflow-run-state';
import { workflowViewOf } from './workflow-update';
import type { WorkflowState } from './entities/session.entity';

const IDS = ['receive-question', 'load-catalog', 'analyse', 'wrap-up'];
const NOW = new Date('2026-11-09T10:00:00.000Z');
const AT = NOW.toISOString();

const start = (stepId: string): WorkflowStepEvent => ({
  kind: 'start',
  stepId,
});
const end = (stepId: string, status: string): WorkflowStepEvent => ({
  kind: 'end',
  stepId,
  status,
});

/** Apply events in order, as the orchestrator does (agents.md 5.11). */
function replay(
  events: WorkflowStepEvent[],
  initial?: WorkflowState,
): WorkflowState | undefined {
  let state = initial;
  for (const event of events) {
    state = workflowRunState(state, event, IDS, NOW) ?? state;
  }
  return state;
}

describe('workflowRunState (agents.md 5.11, agent-panel R8a)', () => {
  it('makes a starting step current', () => {
    expect(
      workflowRunState(undefined, start('receive-question'), IDS, NOW),
    ).toEqual({ current: 1, done: [], updatedAt: AT });
  });

  it('adds a step that ends successfully to done', () => {
    expect(
      workflowRunState(
        { current: 2, done: [1], updatedAt: AT },
        end('load-catalog', 'success'),
        IDS,
        NOW,
      ),
    ).toEqual({ current: 2, done: [1, 2], updatedAt: AT });
  });

  it('ends a whole run with every step done and the last one current', () => {
    const events = IDS.flatMap((id) => [start(id), end(id, 'success')]);
    expect(replay(events)).toEqual({
      current: 4,
      done: [1, 2, 3, 4],
      updatedAt: AT,
    });
  });

  it('marks a failing step failed and keeps it current', () => {
    const state = replay([
      start('receive-question'),
      end('receive-question', 'success'),
      start('load-catalog'),
      end('load-catalog', 'success'),
      start('analyse'),
      end('analyse', 'failed'),
    ]);
    expect(state).toEqual({
      current: 3,
      done: [1, 2],
      failed: 3,
      updatedAt: AT,
    });
  });

  it('leaves the state as it is when a step ends early (a stopped turn)', () => {
    const before: WorkflowState = { current: 3, done: [1, 2], updatedAt: AT };
    expect(
      workflowRunState(before, end('analyse', 'bailed'), IDS, NOW),
    ).toBeUndefined();
  });

  it('starts over when the first step starts again: nothing done, nothing failed', () => {
    const previous: WorkflowState = {
      current: 3,
      done: [1, 2],
      failed: 3,
      updatedAt: AT,
    };
    expect(
      workflowRunState(previous, start('receive-question'), IDS, NOW),
    ).toEqual({ current: 1, done: [], updatedAt: AT });
  });

  it('ignores a step the workflow does not have', () => {
    expect(
      workflowRunState(undefined, start('nested-step'), IDS, NOW),
    ).toBeUndefined();
  });
});

describe('stepEventOf', () => {
  it('reads the engine step events', () => {
    expect(
      stepEventOf({
        type: 'workflow-step-start',
        payload: { id: 'analyse', status: 'running' },
      }),
    ).toEqual({ kind: 'start', stepId: 'analyse' });
    expect(
      stepEventOf({
        type: 'workflow-step-result',
        payload: { id: 'analyse', status: 'failed' },
      }),
    ).toEqual({ kind: 'end', stepId: 'analyse', status: 'failed' });
  });

  it('ignores every other event', () => {
    expect(stepEventOf({ type: 'workflow-start' })).toBeUndefined();
    expect(
      stepEventOf({ type: 'workflow-step-output', payload: { id: 'analyse' } }),
    ).toBeUndefined();
  });
});

describe('the workflow view of a workflow-backed agent', () => {
  const phases = workflowStepPhases([
    { title: 'Receive question' },
    { title: 'Load catalog' },
    { title: 'Analyse' },
    { title: 'Wrap up' },
  ]);

  it('shows the steps before any turn, none current', () => {
    expect(workflowViewOf(phases, undefined, 'workflow')).toEqual({
      phases: [
        { number: 1, title: 'Receive question' },
        { number: 2, title: 'Load catalog' },
        { number: 3, title: 'Analyse' },
        { number: 4, title: 'Wrap up' },
      ],
      source: 'workflow',
      current: null,
      done: [],
      skipped: [],
    });
  });

  it('carries the failed step', () => {
    expect(
      workflowViewOf(
        phases,
        { current: 3, done: [1, 2], failed: 3, updatedAt: AT },
        'workflow',
      ),
    ).toMatchObject({ current: 3, done: [1, 2], failed: 3 });
  });

  it('keeps the prompt source by default', () => {
    expect(workflowViewOf(phases, undefined)?.source).toBe('prompt');
  });
});
