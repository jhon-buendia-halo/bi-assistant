import { agentWorkflow } from './agent-workflows';

describe('agentWorkflow (api.md 34, agents-evals R108)', () => {
  it("returns v2's turn workflow with its four steps in run order", () => {
    const workflow = agentWorkflow('assistant-v2');
    expect(workflow?.id).toBe('qti-v2-turn');
    expect(workflow?.steps.map((step) => [step.title, step.kind])).toEqual([
      ['Receive question', 'code'],
      ['Load catalog', 'code'],
      ['Analyse', 'agent'],
      ['Wrap up', 'code'],
    ]);
  });

  it('gives only the agent step its agent, tools and step limit', () => {
    const steps = agentWorkflow('assistant-v2')!.steps;
    expect(steps.find((step) => step.id === 'analyse')?.agent).toEqual({
      name: 'Questions to Insights v2',
      tools: ['list_entities', 'describe_entity', 'run_readonly_sql'],
      maxSteps: 15,
    });
    expect(
      steps.filter((step) => step.kind === 'code').map((step) => step.agent),
    ).toEqual([undefined, undefined, undefined]);
  });

  it('carries each step’s fields and other exits', () => {
    const steps = agentWorkflow('assistant-v2')!.steps;
    expect(steps[1]).toMatchObject({
      input: ['question', 'datasets'],
      output: ['question', 'catalog'],
      exits: [],
    });
    expect(steps[0].exits).toEqual([
      { label: 'Empty question', outcome: 'fails' },
    ]);
    expect(steps[2].exits).toEqual([
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
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
    first.steps[2].agent!.tools.push('y');
    const second = agentWorkflow('assistant-v2')!;
    expect(second.steps[0].input).toEqual(['question', 'datasets']);
    expect(second.steps[2].agent!.tools).toHaveLength(3);
  });
});
