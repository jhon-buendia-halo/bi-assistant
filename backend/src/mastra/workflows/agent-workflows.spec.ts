import { agentWorkflow } from './agent-workflows';

const V2_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'explore_result',
  'ask_clarification',
];

describe('agentWorkflow (api.md 34, agents-evals R108)', () => {
  it("returns v2's turn workflow with its thirteen steps in catalogue order", () => {
    const workflow = agentWorkflow('insights-analyst');
    expect(workflow?.id).toBe('answer-business-question');
    expect(workflow?.steps.map((step) => [step.title, step.kind])).toEqual([
      ['Read images', 'agent'],
      ['Receive question', 'code'],
      ['Load catalog', 'code'],
      ['Interpret follow-up', 'agent'],
      ['Plan', 'agent'],
      ['Clarify', 'code'],
      ['Analyse', 'agent'],
      ['Validate', 'code'],
      ['Write answer', 'agent'],
      ['Build visual', 'agent'],
      ['Wrap up', 'code'],
      ['Page result', 'code'],
      ['Page answer', 'code'],
    ]);
  });

  // agents.md 2.15, 5.11, 5.13, 5.18; plan D5, D6.
  it.each(['insights-analyst', 'data-readiness'])(
    "gives %s's Read images to Zoe, in one model call without tools",
    (key) => {
      // First in Answer a Business Question; after Score readiness in
      // Assess Data Readiness, whose Zoe starts at Resolve dataset.
      const step = agentWorkflow(key)!.steps.find(
        (candidate) => candidate.id === 'read-images',
      );
      expect(step?.agent).toEqual({
        key: 'image-reader',
        name: 'Zoe',
        role: 'Image Analyst',
        tools: [],
        maxSteps: 1,
      });
    },
  );

  it('gives Build visual to Ryan, in one model call without tools', () => {
    const steps = agentWorkflow('insights-analyst')!.steps;
    expect(steps.find((step) => step.id === 'build-visual')?.agent).toEqual({
      key: 'visualization',
      name: 'Ryan',
      role: expect.any(String) as unknown,
      tools: [],
      maxSteps: 1,
    });
  });

  it('gives each agent step its own agent: Michael analyses with his tools, Olivia plans and Jessica writes in one model call without tools', () => {
    const steps = agentWorkflow('insights-analyst')!.steps;
    const agentOf = (id: string) => steps.find((step) => step.id === id)?.agent;
    // Each agent by its key and persona (agents.md 1.1, 5.11).
    expect(agentOf('analyse')).toEqual({
      key: 'insights-analyst',
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
    // Nathan reads a follow-up over an earlier result (roadmap 1.28.8).
    expect(agentOf('interpret-follow-up')).toEqual({
      key: 'result-explorer',
      name: 'Nathan',
      role: 'Result Explorer',
      tools: [],
      maxSteps: 1,
    });
    expect(
      steps.filter((step) => step.kind === 'code').map((step) => step.agent),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // The catalogue's own flag stays out of the API's step.
    expect(steps.every((step) => !('modelOnly' in step))).toBe(true);
  });

  it('carries each step’s fields and other exits', () => {
    const steps = agentWorkflow('insights-analyst')!;
    const step = (id: string) => steps.steps.find((s) => s.id === id)!;
    expect(step('load-catalog')).toMatchObject({
      input: ['question', 'datasets', 'imageNotes'],
      output: ['question', 'catalog', 'columns', 'imageNotes'],
      exits: [],
    });
    // Receive question has no exit: the input node checks the question first.
    expect(step('receive-question').exits).toEqual([]);
    // Analyse can ask a clarifying question: the run waits for the answer;
    // in an interactive run its attempt waits for approval (workflows R44).
    expect(step('analyse').exits).toEqual([
      { label: 'the model returns an error', outcome: 'fails' },
      { label: 'you stop it', outcome: 'stops' },
      { label: 'if it asks you a question', outcome: 'waits' },
      { label: 'until you approve its work', outcome: 'waits' },
    ]);
    expect(step('plan').exits).toEqual([
      { label: 'the model returns an error', outcome: 'fails' },
      { label: 'you stop it', outcome: 'stops' },
      { label: 'until you approve its work', outcome: 'waits' },
    ]);
    expect(step('write-answer').output).toEqual([
      'headline',
      'answer',
      'calls',
    ]);
  });

  it('is Assess Data Readiness for data-readiness: its one agent step is Explain report (agents.md 5.13)', () => {
    const workflow = agentWorkflow('data-readiness')!;
    expect(workflow.id).toBe('data-readiness-assessment');
    expect(
      workflow.steps.flatMap((step) =>
        step.agent ? [[step.id, step.agent.key, step.agent.maxSteps]] : [],
      ),
    ).toEqual([
      ['read-images', 'image-reader', 1],
      ['explain-report', 'data-readiness', 10],
    ]);
  });

  it.each(['assistant', 'rfp', 'constructor', 'nope'])(
    'is undefined for %p, which is not workflow-backed',
    (key) => {
      expect(agentWorkflow(key)).toBeUndefined();
    },
  );

  it('returns a copy the caller can change safely', () => {
    const first = agentWorkflow('insights-analyst')!;
    first.steps[1].input.push('x');
    first.steps[6].agent!.tools.push('y');
    const second = agentWorkflow('insights-analyst')!;
    expect(second.steps[1].input).toEqual([
      'question',
      'datasets',
      'imageNotes',
    ]);
    expect(second.steps[6].agent!.tools).toHaveLength(6);
  });
});
