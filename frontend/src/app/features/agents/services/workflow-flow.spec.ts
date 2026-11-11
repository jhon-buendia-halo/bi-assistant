import { AgentWorkflow } from './agents-api.service';
import { workflowCards } from './workflow-flow';

const WORKFLOW: AgentWorkflow = {
  id: 'qti-v2-turn',
  steps: [
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      summary: 'Trims the question.',
      input: ['question', 'datasets'],
      output: ['question', 'datasets'],
      exits: [{ label: 'Empty question', outcome: 'fails' }],
    },
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary: 'The agent answers.',
      input: ['question', 'datasets'],
      output: ['calls', 'stopped'],
      agent: { name: 'v2', tools: ['run_readonly_sql'], maxSteps: 15 },
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
      ],
    },
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      summary: 'Counts.',
      input: ['calls', 'stopped'],
      output: ['rows'],
      exits: [],
    },
  ],
};

describe('workflowCards (agents-evals R108)', () => {
  it('numbers the steps from 1 in run order and names their kind', () => {
    expect(
      workflowCards(WORKFLOW).map((card) => [
        card.number,
        card.step.title,
        card.kindLabel,
      ]),
    ).toEqual([
      [1, 'Receive question', 'Code'],
      [2, 'Analyse', 'LLM'],
      [3, 'Wrap up', 'Code'],
    ]);
  });

  it('labels each arrow with the fields passed on, and the last step has none', () => {
    expect(workflowCards(WORKFLOW).map((card) => card.edgeLabel)).toEqual([
      'question, datasets',
      'calls, stopped',
      null,
    ]);
  });

  it('words each other exit by its outcome', () => {
    expect(workflowCards(WORKFLOW).map((card) => card.exits)).toEqual([
      [{ text: 'Empty question → fails the turn', outcome: 'fails' }],
      [
        { text: 'Model error → fails the turn', outcome: 'fails' },
        { text: 'Stop → ends the turn here', outcome: 'stops' },
      ],
      [],
    ]);
  });

  it('returns no cards for a workflow with no steps', () => {
    expect(workflowCards({ id: 'empty', steps: [] })).toEqual([]);
  });
});
