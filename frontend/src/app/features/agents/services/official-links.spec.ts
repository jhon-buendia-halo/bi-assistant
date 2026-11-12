import {
  officialGraphInput,
  officialLinkSkills,
  officialLinkTools,
  officialPromptCopy,
} from './official-links';
import { LINKABLE_TOOLS } from './prompt-links';

const SKILLS = [
  {
    name: 'curated-knowledge',
    loading: 'on-demand' as const,
    agents: ['assistant'],
  },
  { name: 'deep-analysis', loading: 'harness' as const, agents: ['assistant'] },
  {
    name: 'report-outline',
    loading: 'on-demand' as const,
    agents: ['report'],
    tools: ['list_clients', 'get_report'],
  },
  {
    name: 'report-package',
    loading: 'on-demand' as const,
    agents: ['report'],
    tools: ['get_report'],
  },
];

const report = {
  key: 'report',
  name: 'Report Builder',
  toolDetails: [
    { name: 'list_clients', description: 'List the clients. Then more.' },
    { name: 'get_report', description: 'Read one report record.' },
    { name: 'ask_clarification', description: 'Ask one question.' },
  ],
  prompt: {
    editable:
      'You are the Report Builder. Load [[skill:report-outline]], then [[tool:list_clients]].',
  },
};

describe('official-links (agents-evals R99, R105)', () => {
  it("links the assistant's library tools and the Report Builder's own tools", () => {
    expect(officialLinkTools({ key: 'assistant', toolDetails: [] })).toBe(
      LINKABLE_TOOLS,
    );
    expect(officialLinkTools(report)).toEqual([
      { kind: 'tool', name: 'list_clients', description: 'List the clients.' },
      { kind: 'tool', name: 'get_report', description: 'Read one report record.' },
      {
        kind: 'tool',
        name: 'ask_clarification',
        description: 'Ask one question.',
      },
    ]);
  });

  it('offers only the on-demand built-in skills the agent gets', () => {
    expect(officialLinkSkills(SKILLS, 'assistant').map((s) => s.name)).toEqual([
      'curated-knowledge',
    ]);
    expect(officialLinkSkills(SKILLS, 'report').map((s) => s.name)).toEqual([
      'report-outline',
      'report-package',
    ]);
    expect(officialLinkSkills(null, 'report')).toEqual([]);
  });

  it("draws the Report Builder's graph: its skills with the tools each links, and every tool, always on", () => {
    const graph = officialGraphInput(report, SKILLS);
    expect(graph.skills).toEqual([
      { name: 'report-outline', tools: ['list_clients', 'get_report'] },
      { name: 'report-package', tools: ['get_report'] },
    ]);
    expect(graph.toolLinks).toEqual([
      {
        name: 'list_clients',
        status: 'always-on',
        linkedVia: { instructions: true, skills: ['report-outline'] },
      },
      {
        name: 'get_report',
        status: 'always-on',
        linkedVia: {
          instructions: false,
          skills: ['report-outline', 'report-package'],
        },
      },
      {
        name: 'ask_clarification',
        status: 'always-on',
        linkedVia: { instructions: false, skills: [] },
      },
    ]);
  });

  it("names the agent in the editor's copy, the assistant's unchanged", () => {
    expect(
      officialPromptCopy({
        key: 'assistant',
        name: 'Questions to Insights Assistant',
      }),
    ).toEqual({
      toolbarHint:
        'Type / to link a tool or a built-in skill. Links here are mentions; the assistant keeps all its tools.',
      toolsNote:
        'The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.',
      generatedToolsNote:
        '## Tools — generated from the tools the assistant gets',
    });
    expect(
      officialPromptCopy({ key: 'report', name: 'Report Builder' })
        .generatedToolsNote,
    ).toBe('## Tools — generated from the tools the Report Builder gets');
  });

  it('names Questions to Insights v2 without an article and offers tools only (R107)', () => {
    expect(
      officialPromptCopy({
        key: 'assistant-v2',
        name: 'Questions to Insights v2',
      }),
    ).toEqual({
      toolbarHint:
        'Type / to link a tool. Links here are mentions; Questions to Insights v2 keeps all its tools.',
      toolsNote:
        'The ## Tools list is generated from the tools Questions to Insights v2 gets and is inserted before ## Working rules.',
      generatedToolsNote:
        '## Tools — generated from the tools Questions to Insights v2 gets',
    });
  });
});
