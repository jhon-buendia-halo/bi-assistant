import { agentWorkflow } from './agent-workflows';

describe('agentWorkflow (api.md 34, agents-evals R108)', () => {
  it("returns Avery + Michael for insights-analyst: Avery's one Orchestrate step", () => {
    const workflow = agentWorkflow('insights-analyst');
    expect(workflow?.id).toBe('orchestrated-answer-michael');
    expect(workflow?.steps.map((step) => [step.title, step.kind])).toEqual([
      ['Orchestrate', 'agent'],
    ]);
  });

  it('gives Orchestrate to Avery with her tools and her team: Michael and Clara', () => {
    const [step] = agentWorkflow('insights-analyst')!.steps;
    expect(step.agent).toEqual({
      key: 'chief-of-staff',
      name: 'Avery',
      role: 'Chief of Staff',
      tools: [
        'answer_from_data',
        'build_dashboard',
        'export_conversation',
        'ask_clarification',
      ],
      maxSteps: 16,
      team: [
        {
          tool: 'answer_from_data',
          key: 'insights-analyst',
          name: 'Michael',
          role: 'Insights Analyst',
        },
        {
          tool: 'build_dashboard',
          key: 'bi-analyst',
          name: 'Clara',
          role: expect.any(String) as unknown,
        },
      ],
    });
    // The catalogue's own flag stays out of the API's step.
    expect(step).not.toHaveProperty('modelOnly');
  });

  it('carries the step’s fields and exits', () => {
    const [step] = agentWorkflow('insights-analyst')!.steps;
    expect(step).toMatchObject({
      input: ['question', 'datasets', 'images'],
      output: ['answer'],
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
        { label: 'if it asks you a question', outcome: 'waits' },
      ],
    });
  });

  it('is Assess Data Readiness for data-readiness: its one agent step is Explain report (agents.md 5.13)', () => {
    const workflow = agentWorkflow('data-readiness')!;
    expect(workflow.id).toBe('data-readiness-assessment');
    expect(
      workflow.steps.flatMap((step) =>
        step.agent ? [[step.id, step.agent.key, step.agent.maxSteps]] : [],
      ),
    ).toEqual([['explain-report', 'data-readiness', 10]]);
  });

  it.each(['assistant', 'rfp', 'constructor', 'nope'])(
    'is undefined for %p, which is not workflow-backed',
    (key) => {
      expect(agentWorkflow(key)).toBeUndefined();
    },
  );

  it('returns a copy the caller can change safely', () => {
    const first = agentWorkflow('insights-analyst')!;
    first.steps[0].input.push('x');
    first.steps[0].agent!.tools.push('y');
    const second = agentWorkflow('insights-analyst')!;
    expect(second.steps[0].input).toEqual(['question', 'datasets', 'images']);
    expect(second.steps[0].agent!.tools).toHaveLength(4);
  });
});
