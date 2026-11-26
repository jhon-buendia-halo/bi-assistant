import { workflowViewOf } from './workflow-update';
import type { WorkflowState } from './entities/session.entity';

const saved: WorkflowState = {
  current: 2,
  done: [1],
  skipped: [4],
  waiting: true,
  note: 'Pick one',
  steps: ['One', 'Two', 'Three', 'Four'],
  updatedAt: 'x',
};

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
