import { applyWorkflowUpdate, workflowViewOf } from './workflow-update';
import type { WorkflowState } from './entities/session.entity';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const apply = (
  input: Parameters<typeof applyWorkflowUpdate>[0],
  promptSteps = 0,
  state?: WorkflowState,
) => applyWorkflowUpdate(input, { promptSteps, state, now: NOW });

const saved: WorkflowState = {
  current: 2,
  done: [1],
  skipped: [4],
  waiting: true,
  note: 'Pick one',
  steps: ['One', 'Two', 'Three', 'Four'],
  updatedAt: 'x',
};

describe('applyWorkflowUpdate (update_workflow rules)', () => {
  it('creates agent-defined steps, resetting the state', () => {
    const { state, result } = apply(
      { steps: ' Scope | Analyse |  | Report ' },
      0,
      saved,
    );
    expect(state).toEqual({
      current: 1,
      done: [],
      steps: ['Scope', 'Analyse', 'Report'],
      updatedAt: NOW.toISOString(),
    });
    expect(result).toEqual({
      updated: true,
      steps: 3,
      current: 1,
      done: [],
      skipped: [],
    });
  });

  it('applies the status given with new steps', () => {
    const { state } = apply({ steps: 'A | B | C', current: 2, done: '1' });
    expect(state).toMatchObject({ current: 2, done: [1] });
  });

  it('refuses steps under a prompt section, and bad step lists', () => {
    expect(() => apply({ steps: 'A | B' }, 3)).toThrow(
      'Your ## Workflow section defines the steps; set their status instead',
    );
    const message = 'steps takes 2 to 12 titles of at most 80 characters each';
    expect(() => apply({ steps: 'A' })).toThrow(message);
    expect(() => apply({ steps: '' })).toThrow(message);
    expect(() =>
      apply({ steps: Array.from({ length: 13 }, (_, i) => `S${i}`).join('|') }),
    ).toThrow(message);
    expect(() => apply({ steps: `A | ${'x'.repeat(81)}` })).toThrow(message);
    expect(() =>
      apply({ steps: Array.from({ length: 12 }, (_, i) => `S${i}`).join('|') }),
    ).not.toThrow();
  });

  it('needs steps when there is no workflow', () => {
    expect(() => apply({ current: 1 })).toThrow(
      'There is no workflow yet: pass steps to create one',
    );
  });

  it('checks current, done and skipped against the step count', () => {
    expect(() => apply({ current: 0 }, 3)).toThrow(
      'current must be a step number from 1 to 3',
    );
    expect(() => apply({ current: 4 }, 3)).toThrow(
      'current must be a step number from 1 to 3',
    );
    expect(() => apply({ done: '1,4' }, 3)).toThrow(
      'done must list step numbers from 1 to 3',
    );
    expect(() => apply({ done: 'x' }, 3)).toThrow(
      'done must list step numbers from 1 to 3',
    );
    expect(() => apply({ skipped: '0' }, 3)).toThrow(
      'skipped must list step numbers from 1 to 3',
    );
  });

  it('checks the note', () => {
    expect(() => apply({ note: 'x'.repeat(2001) }, 3)).toThrow(
      'The note is at most 2,000 characters',
    );
  });

  it('keeps current, done, skipped and the card when omitted', () => {
    const { state } = apply({}, 4, saved);
    expect(state).toMatchObject({
      current: 2,
      done: [1],
      skipped: [4],
      waiting: true,
      note: 'Pick one',
    });
    // A prompt section's steps are not stored.
    expect(state).not.toHaveProperty('steps');
  });

  it('clears the card when current changes, keeps it when it does not', () => {
    const moved = apply({ current: 3, done: '1,2' }, 4, saved).state;
    expect(moved).toMatchObject({ current: 3, done: [1, 2], skipped: [4] });
    expect(moved).not.toHaveProperty('waiting');
    expect(moved).not.toHaveProperty('note');

    const same = apply({ current: 2, note: 'New note' }, 4, saved).state;
    expect(same).toMatchObject({
      current: 2,
      waiting: true,
      note: 'New note',
    });
  });

  it('sets and clears the card fields explicitly', () => {
    const { state } = apply({ waiting: false, note: '' }, 4, saved);
    expect(state).not.toHaveProperty('waiting');
    expect(state).not.toHaveProperty('note');
  });

  it('stores todos per step, keeps them, restores a default and resets with new steps', () => {
    const first = apply({ todo: '3: Confirm lines | 4: Pick carriers' }, 4);
    expect(first.state.todos).toEqual({
      '3': 'Confirm lines',
      '4': 'Pick carriers',
    });
    const kept = apply({ current: 3 }, 4, first.state);
    expect(kept.state.todos).toEqual(first.state.todos);
    const replaced = apply({ todo: '3: Other | 4:' }, 4, first.state);
    expect(replaced.state.todos).toEqual({ '3': 'Other' });
    expect(
      apply({ todo: '3:' }, 4, replaced.state).state.todos,
    ).toBeUndefined();
    // New agent steps clear them; fewer steps drop the ones past the end.
    expect(
      apply({ steps: 'A | B' }, 0, first.state).state.todos,
    ).toBeUndefined();
    expect(apply({ current: 1 }, 3, first.state).state.todos).toEqual({
      '3': 'Confirm lines',
    });
  });

  it('checks the todo', () => {
    const format = 'todo must list "<step>: <action>" items separated by " | "';
    expect(() => apply({ todo: 'do it' }, 4)).toThrow(format);
    expect(() => apply({ todo: '' }, 4)).toThrow(format);
    expect(() => apply({ todo: '2 Do it' }, 4)).toThrow(format);
    expect(() => apply({ todo: '0: x' }, 4)).toThrow(
      'todo step 0 is not a step number from 1 to 4',
    );
    expect(() => apply({ todo: '5: x' }, 4)).toThrow(
      'todo step 5 is not a step number from 1 to 4',
    );
    expect(() => apply({ todo: `1: ${'x'.repeat(121)}` }, 4)).toThrow(
      'A step action is at most 120 characters',
    );
    expect(
      apply({ todo: `1: ${'x'.repeat(120)}` }, 4).state.todos,
    ).toBeDefined();
  });

  it('starts on the first step not done or skipped when nothing is stored', () => {
    expect(apply({ done: '1', skipped: '2' }, 4).result.current).toBe(3);
    expect(apply({ done: '1,2' }, 2).result.current).toBe(2);
  });
});

describe('workflowViewOf', () => {
  const prompt = [
    { number: 1, title: 'Ask', skill: 's' },
    { number: 2, title: 'Answer' },
  ];

  it('is undefined without steps', () => {
    expect(workflowViewOf([], undefined)).toBeUndefined();
    expect(
      workflowViewOf([], { current: 1, done: [], updatedAt: 'x' }),
    ).toBeUndefined();
  });

  it('takes the phases from the prompt section, else from the saved steps', () => {
    const state: WorkflowState = { ...saved, current: 2, steps: ['X', 'Y'] };
    expect(workflowViewOf(prompt, state)).toMatchObject({
      source: 'prompt',
      phases: prompt,
    });
    expect(workflowViewOf([], state)).toMatchObject({
      source: 'agent',
      phases: [
        { number: 1, title: 'X' },
        { number: 2, title: 'Y' },
      ],
    });
  });

  it('shows the prompt steps before any state, with no current', () => {
    expect(workflowViewOf(prompt, undefined)).toEqual({
      phases: prompt,
      source: 'prompt',
      current: null,
      done: [],
      skipped: [],
    });
  });

  it('carries skipped, waiting, and note, and drops numbers past the list', () => {
    expect(
      workflowViewOf(prompt, {
        current: 2,
        done: [1, 9],
        skipped: [3],
        waiting: true,
        note: 'n',
        updatedAt: 'x',
      }),
    ).toEqual({
      phases: prompt,
      source: 'prompt',
      current: 2,
      done: [1],
      skipped: [],
      waiting: true,
      note: 'n',
    });
    expect(
      workflowViewOf(prompt, {
        current: 5,
        done: [],
        waiting: true,
        updatedAt: 'x',
      }),
    ).toMatchObject({ current: null });
  });

  it('gives each phase the agent todo, else the prompt default action (BA-231)', () => {
    const withActions = [
      { number: 1, title: 'Ask', action: 'Say who.' },
      { number: 2, title: 'Pick', action: 'Pick one.' },
    ];
    expect(
      workflowViewOf(withActions, {
        current: 1,
        done: [],
        todos: { '2': 'Pick Medical', '9': 'gone' },
        updatedAt: 'x',
      })?.phases,
    ).toEqual([
      { number: 1, title: 'Ask', action: 'Say who.' },
      { number: 2, title: 'Pick', action: 'Pick Medical' },
    ]);
    // Agent-defined steps take the action from the todo only.
    expect(
      workflowViewOf([], {
        current: 1,
        done: [],
        steps: ['A', 'B'],
        todos: { '1': 'Do A' },
        updatedAt: 'x',
      })?.phases,
    ).toEqual([
      { number: 1, title: 'A', action: 'Do A' },
      { number: 2, title: 'B' },
    ]);
  });
});
