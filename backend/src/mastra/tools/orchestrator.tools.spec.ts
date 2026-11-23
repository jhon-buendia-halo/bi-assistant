import { RequestContext } from '@mastra/core/request-context';
import {
  ORCHESTRATOR_TEAMS,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  teammateOfTool,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer.steps';
import { buildDashboardTool, orchestratorTools } from './orchestrator.tools';

function runtime(
  overrides: Partial<OrchestratorToolsRuntime> = {},
): OrchestratorToolsRuntime {
  return {
    tools: ORCHESTRATOR_TEAMS['orchestrated-answer'].tools,
    hasImages: false,
    buildsVisual: true,
    buildsDashboard: false,
    readImages: jest.fn(),
    plan: jest.fn(),
    analyse: jest.fn(),
    answerFromData: jest.fn(),
    writeAnswer: jest.fn(),
    buildVisual: jest.fn(),
    buildDashboard: jest.fn().mockResolvedValue('Clara built it.'),
    ...overrides,
  };
}

function contextWith(run: OrchestratorToolsRuntime): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, run);
  return requestContext;
}

describe("Avery's build_dashboard (plan bi-dashboard 2.2)", () => {
  it('is hidden while the run builds no dashboard', () => {
    expect(
      Object.keys(orchestratorTools(contextWith(runtime()))),
    ).not.toContain('build_dashboard');
  });

  it('is offered once the user asks for a dashboard, in both of her workflows', () => {
    for (const id of ['orchestrated-answer', 'orchestrated-answer-michael']) {
      const tools = orchestratorTools(
        contextWith(
          runtime({
            tools: ORCHESTRATOR_TEAMS[id].tools,
            buildsDashboard: true,
          }),
        ),
      );
      expect(Object.keys(tools)).toContain('build_dashboard');
    }
  });

  it('is listed with no run (her agent page)', () => {
    expect(Object.keys(orchestratorTools(new RequestContext()))).toContain(
      'build_dashboard',
    );
    expect(Object.keys(orchestratorTools(undefined))).toContain(
      'build_dashboard',
    );
  });

  it('calls Clara with the brief and answers Avery in text', async () => {
    const buildDashboard = jest.fn().mockResolvedValue('Clara built it.');
    const run = runtime({ buildsDashboard: true, buildDashboard });
    const execute = buildDashboardTool.execute as unknown as (
      input: { brief: string },
      context: { requestContext: RequestContext },
    ) => Promise<unknown>;
    await expect(
      execute(
        { brief: 'Goals by team and tournament' },
        { requestContext: contextWith(run) },
      ),
    ).resolves.toEqual({ result: 'Clara built it.' });
    expect(buildDashboard).toHaveBeenCalledWith('Goals by team and tournament');
  });

  it('is Clara’s tool in the team registry', () => {
    expect(teammateOfTool('build_dashboard')).toBe('bi-analyst');
    expect(ORCHESTRATOR_TEAMS['orchestrated-answer-michael'].tools).toEqual([
      'answer_from_data',
      'build_dashboard',
      'ask_clarification',
    ]);
    expect(ORCHESTRATOR_TEAMS['orchestrated-answer'].tools.at(-2)).toBe(
      'build_dashboard',
    );
  });
});
