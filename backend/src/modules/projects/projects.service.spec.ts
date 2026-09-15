jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    set = jest.fn();
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/tool-services', () => ({
  setSandboxToolServices: jest.fn(),
}));
jest.mock('../../mastra/tools/sandbox.tools', () => ({
  SANDBOXES_CONTEXT_KEY: 'sandboxes',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual',
  PROJECT_ID_CONTEXT_KEY: 'project-id',
}));
jest.mock('../../mastra/project-workspaces', () => ({
  PROJECT_WORKSPACE_CONTEXT_KEY: 'project-workspace',
}));
jest.mock('../sandbox/repositories/sandbox.repository', () => ({
  SandboxRepository: class {},
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('./repositories/projects.repository', () => ({
  ProjectsRepository: class {},
}));
jest.mock('./visualization.service', () => ({
  VisualizationService: class {},
}));

import { ProjectsService, StreamEvent } from './projects.service';
import type { ProjectDoc } from './entities/project.entity';

describe('ProjectsService streaming', () => {
  it('synthesizes a final answer after a tool-only turn', async () => {
    const project: ProjectDoc = {
      id: 'project-1',
      name: 'World Cup analysis',
      sandboxes: ['football'],
      messages: [],
      visualizations: [],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(project, patch);
        return project;
      }),
    };
    const fullStream = toolOnlyStream(15);
    const agent = {
      getMemory: jest.fn().mockResolvedValue({
        getThreadById: jest.fn().mockResolvedValue({ id: project.id }),
      }),
      stream: jest.fn().mockResolvedValue({
        fullStream,
        text: Promise.resolve(''),
      }),
      generate: jest.fn().mockResolvedValue({
        text: 'Argentina won through superior chance creation.',
      }),
    };
    const service = new ProjectsService(
      repository as never,
      {
        getAgent: jest.fn().mockReturnValue(agent),
        ensureProjectWorkspace: jest
          .fn()
          .mockResolvedValue({ id: 'workspace-1' }),
      } as never,
      { getByNames: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      } as never,
      {} as never,
    );
    const events: StreamEvent[] = [];

    await service.streamMessage(
      'project-1',
      'Why did Argentina win?',
      (event) => events.push(event),
    );

    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('Why did Argentina win?'),
      expect.objectContaining({ maxSteps: 1, toolChoice: 'none' }),
    );
    expect(project.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Argentina won through superior chance creation.',
      }),
    );
    expect(events.at(-1)).toEqual({ type: 'done', project });
  });
});

async function* toolOnlyStream(count: number) {
  for (let index = 0; index < count; index++) {
    const toolCallId = `call-${index}`;
    yield {
      type: 'tool-call',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        args: { sql: `select ${index}` },
      },
    };
    yield {
      type: 'tool-result',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        result: { columns: ['value'], rows: [{ value: index }] },
      },
    };
  }
}
