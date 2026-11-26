import {
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
  { name: 'harness-only', loading: 'harness' as const, agents: ['assistant'] },
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
      {
        kind: 'tool',
        name: 'get_report',
        description: 'Read one report record.',
      },
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

  it("names the agent in the editor's copy by its persona name, with no article (R107)", () => {
    expect(officialPromptCopy({ key: 'assistant', name: 'Emily' })).toEqual({
      toolbarHint:
        'Type / to link a tool or a built-in skill. Links here are mentions; Emily keeps every tool.',
      toolsNote:
        'The ## Tools list is generated from the tools Emily gets and is inserted before ## Working rules.',
      generatedToolsNote: '## Tools — generated from the tools Emily gets',
    });
    expect(
      officialPromptCopy({ key: 'insights-analyst', name: 'Michael' })
        .generatedToolsNote,
    ).toBe('## Tools — generated from the tools Michael gets');
  });
});
