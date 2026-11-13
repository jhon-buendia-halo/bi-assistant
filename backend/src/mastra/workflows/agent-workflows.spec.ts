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

  it('gives the agent steps their agent: Analyse with its tools, Plan and Write answer one model call without tools', () => {
    const steps = agentWorkflow('assistant-v2')!.steps;
    const agentOf = (id: string) => steps.find((step) => step.id === id)?.agent;
    expect(agentOf('analyse')).toEqual({
      name: 'Questions to Insights v2',
      tools: V2_TOOLS,
      maxSteps: 15,
    });
    for (const id of ['plan', 'write-answer']) {
      expect(agentOf(id)).toEqual({
        name: 'Questions to Insights v2',
        tools: [],
        maxSteps: 1,
      });
    }
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
      output: ['question', 'catalog'],
      exits: [],
    });
    // Receive question has no exit: the input node checks the question first.
    expect(step('receive-question').exits).toEqual([]);
    // Analyse can end with a clarifying question: the run stops with it.
    expect(step('analyse').exits).toEqual([
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
      { label: 'Clarifying question', outcome: 'stops' },
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
