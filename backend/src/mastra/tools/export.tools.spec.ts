import { RequestContext } from '@mastra/core/request-context';
import {
  EXPORT_TOOLS_RUNTIME_KEY,
  exportConversationTool,
  type ExportToolsRuntime,
} from './export.tools';
import { orchestratorTools } from './orchestrator.tools';
import {
  AVERY_TEAM,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer-michael.steps';

const CONTENT = {
  title: 'World Cup goals',
  summary: ['Version 1 was built.', 'Version 3 has two filters.'],
  turns: [{ number: 1, headline: 'Built version 1', points: [] }],
};

const execute = exportConversationTool.execute as unknown as (
  input: unknown,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

describe('export_conversation, shared by Avery and Elena (agents.md 3.18)', () => {
  it('keeps its id and description', () => {
    expect(exportConversationTool.id).toBe('export_conversation');
    expect(exportConversationTool.description).toBe(
      "Exports the whole conversation (each earlier question, Avery's answer to it and its dashboard, and the queries behind them) to a PDF and a PowerPoint the user downloads and shares. You write the title, the summary and one headline per earlier question; every figure in them must be copied from the answers. Call it only when the user asks to export, download or share the conversation; at most twice per run. Returns what was exported, or the figures to fix.",
    );
  });

  it('is still the export_conversation of Avery’s team tools', () => {
    expect(orchestratorTools(undefined).export_conversation).toBe(
      exportConversationTool,
    );
  });

  it('hands the export runtime the content with its defaults', async () => {
    const exportConversation = jest.fn().mockResolvedValue('Exported.');
    const runtime: ExportToolsRuntime = {
      exportsConversation: true,
      exportConversation,
    };
    const requestContext = new RequestContext();
    requestContext.set(EXPORT_TOOLS_RUNTIME_KEY, runtime);
    await expect(execute(CONTENT, { requestContext })).resolves.toEqual({
      result: 'Exported.',
    });
    expect(exportConversation).toHaveBeenCalledWith({
      ...CONTENT,
      formats: ['pdf', 'pptx'],
      includeSql: false,
    });
  });

  it("still reads Avery's tools runtime when no export runtime is set", async () => {
    const exportConversation = jest.fn().mockResolvedValue('Exported.');
    const avery: OrchestratorToolsRuntime = {
      tools: AVERY_TEAM.tools,
      answerFromData: jest.fn(),
      buildsDashboard: false,
      buildDashboard: jest.fn(),
      exportsConversation: true,
      exportConversation,
    };
    const requestContext = new RequestContext();
    requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, avery);
    await expect(execute(CONTENT, { requestContext })).resolves.toEqual({
      result: 'Exported.',
    });
    expect(exportConversation).toHaveBeenCalledTimes(1);
  });

  it('refuses outside a run', async () => {
    await expect(
      execute(CONTENT, { requestContext: new RequestContext() }),
    ).rejects.toThrow('This tool only runs inside an orchestrated run.');
  });
});
