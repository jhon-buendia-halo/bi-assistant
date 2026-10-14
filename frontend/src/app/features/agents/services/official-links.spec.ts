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
  { name: 'rfp-process', loading: 'on-demand' as const, agents: ['rfp'] },
];

const RFP = {
  key: 'rfp',
  name: 'RFP Builder',
  toolDetails: [
    { name: 'list_clients', description: 'List the clients. Then more.' },
    { name: 'get_rfp', description: 'Read one RFP record.' },
    { name: 'ask_clarification', description: 'Ask one question.' },
  ],
  prompt: {
    editable:
      'You are the RFP Builder. Load [[skill:rfp-process]], then [[tool:list_clients]].',
  },
};

describe('official-links (agents-evals R99, R105)', () => {
  it("links the assistant's library tools and the RFP Builder's own tools", () => {
    expect(officialLinkTools({ key: 'assistant', toolDetails: [] })).toBe(
      LINKABLE_TOOLS,
    );
    expect(officialLinkTools(RFP)).toEqual([
      { kind: 'tool', name: 'list_clients', description: 'List the clients.' },
      { kind: 'tool', name: 'get_rfp', description: 'Read one RFP record.' },
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
    expect(officialLinkSkills(SKILLS, 'rfp').map((s) => s.name)).toEqual([
      'rfp-process',
    ]);
    expect(officialLinkSkills(null, 'rfp')).toEqual([]);
  });

  it("draws the RFP Builder's graph: its skill and every tool, always on", () => {
    const graph = officialGraphInput(RFP, SKILLS);
    expect(graph.skills).toEqual([{ name: 'rfp-process', tools: [] }]);
    expect(graph.toolLinks).toEqual([
      {
        name: 'list_clients',
        status: 'always-on',
        linkedVia: { instructions: true, skills: [] },
      },
      {
        name: 'get_rfp',
        status: 'always-on',
        linkedVia: { instructions: false, skills: [] },
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
      officialPromptCopy({ key: 'rfp', name: 'RFP Builder' })
        .generatedToolsNote,
    ).toBe('## Tools — generated from the tools the RFP Builder gets');
  });
});
