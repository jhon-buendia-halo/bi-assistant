import { AgentWorkflow } from './agents-api.service';
import { workflowCards } from './workflow-flow';

const WORKFLOW: AgentWorkflow = {
  id: 'answer-business-question',
  steps: [
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      summary: 'Trims the question.',
      input: ['question', 'datasets'],
      output: ['question', 'datasets'],
      exits: [],
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
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
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
      [],
      [
        { text: 'Fails the turn if the model returns an error', outcome: 'fails' },
        { text: 'Ends the turn if you stop it', outcome: 'stops' },
      ],
      [],
    ]);
  });

  it("words an exit that waits for the user's answer", () => {
    const waiting = {
      id: 'waits',
      steps: [
        {
          ...WORKFLOW.steps[0],
          exits: [{ label: 'if it asks you a question', outcome: 'waits' as const }],
        },
      ],
    };
    expect(workflowCards(waiting)[0].exits).toEqual([
      {
        text: "Waits if it asks you a question",
        outcome: 'waits',
      },
    ]);
  });

  it('returns no cards for a workflow with no steps', () => {
    expect(workflowCards({ id: 'empty', steps: [] })).toEqual([]);
  });
});
