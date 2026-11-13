import { agentWorkflow } from './agent-workflows';

const V2_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
];

describe('agentWorkflow (api.md 34, agents-evals R108)', () => {
  it("returns v2's turn workflow with its eight steps in catalogue order", () => {
    const workflow = agentWorkflow('assistant-v2');
    expect(workflow?.id).toBe('qti-v2-turn');
    expect(workflow?.steps.map((step) => [step.title, step.kind])).toEqual([
      ['Receive question', 'code'],
      ['Load catalog', 'code'],
      ['Plan', 'agent'],
      ['Clarify', 'code'],
      ['Analyse', 'agent'],
      ['Validate', 'code'],
      ['Write answer', 'agent'],
      ['Wrap up', 'code'],
    ]);
  });

  it('gives each agent step its own agent: Michael analyses with his tools, Olivia plans and Jessica writes in one model call without tools', () => {
    const steps = agentWorkflow('assistant-v2')!.steps;
    const agentOf = (id: string) => steps.find((step) => step.id === id)?.agent;
    // Each agent by its key and persona (agents.md 1.1, 5.11).
    expect(agentOf('analyse')).toEqual({
      key: 'assistant-v2',
      name: 'Michael',
      role: 'Insights Analyst',
      tools: V2_TOOLS,
      maxSteps: 15,
    });
    expect(agentOf('plan')).toEqual({
      key: 'analysis-planner',
      name: 'Olivia',
      role: 'Analysis Lead',
      tools: [],
      maxSteps: 1,
    });
    expect(agentOf('write-answer')).toEqual({
      key: 'answer-writer',
      name: 'Jessica',
      role: 'Insights Writer',
      tools: [],
      maxSteps: 1,
    });
    expect(
      steps.filter((step) => step.kind === 'code').map((step) => step.agent),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // The catalogue's own flag stays out of the API's step.
    expect(steps.every((step) => !('modelOnly' in step))).toBe(true);
  });

  it('carries each step’s fields and other exits', () => {
    const steps = agentWorkflow('assistant-v2')!;
    const step = (id: string) => steps.steps.find((s) => s.id === id)!;
    expect(step('load-catalog')).toMatchObject({
      input: ['question', 'datasets'],
      output: ['question', 'catalog', 'columns'],
      exits: [],
    });
    // Receive question has no exit: the input node checks the question first.
    expect(step('receive-question').exits).toEqual([]);
    // Analyse can ask a clarifying question: the run waits for the answer.
    expect(step('analyse').exits).toEqual([
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
      { label: 'Clarifying question', outcome: 'waits' },
    ]);
    expect(step('plan').exits).toEqual([
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
    ]);
    expect(step('write-answer').output).toEqual([
      'headline',
      'answer',
      'calls',
    ]);
  });

  it.each(['assistant', 'rfp', 'data-readiness', 'constructor', 'nope'])(
    'is undefined for %p, which is not workflow-backed',
    (key) => {
      expect(agentWorkflow(key)).toBeUndefined();
    },
  );

  it('returns a copy the caller can change safely', () => {
    const first = agentWorkflow('assistant-v2')!;
    first.steps[0].input.push('x');
    first.steps[4].agent!.tools.push('y');
    const second = agentWorkflow('assistant-v2')!;
    expect(second.steps[0].input).toEqual(['question', 'datasets']);
    expect(second.steps[4].agent!.tools).toHaveLength(5);
  });
});
