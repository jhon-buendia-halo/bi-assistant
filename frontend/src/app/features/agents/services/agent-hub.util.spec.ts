import { Agent } from './agents-api.service';
import {
  HUB_ROW_SIZE,
  NO_DATASETS_LEFT,
  buildHubSections,
  canStartChat,
  hubEmptyMessage,
  matchesQuery,
  newSessionAgentOptions,
  startChatBlockedReason,
  startsInComposer,
  visibleCards,
} from './agent-hub.util';

function agent(
  key: string,
  name: string,
  kind: 'official' | 'system' | 'user',
  options: { pinned?: boolean; description?: string } = {},
): Agent {
  return {
    key,
    id: key,
    name,
    description: options.description ?? '',
    tools: [],
    kind,
    status: kind === 'user' ? 'draft' : 'builtin',
    pinned: options.pinned ?? false,
    owner:
      kind === 'official' ? 'Official' : kind === 'system' ? 'System' : 'You',
    hasUnpublishedChanges: false,
    missingDatasets: [],
    datasets: [],
    starterQuestions: [],
  };
}

const assistant = agent(
  'assistant',
  'Questions to Insights Assistant',
  'official',
);
const system = [
  agent('sql-verifier', 'SQL Verifier', 'system'),
  agent('assistant-eval-judge', 'Assistant Eval Judge', 'system'),
  agent('sql-fixer', 'SQL Fixer', 'system'),
  agent('knowledge-bootstrap', 'Knowledge Bootstrap', 'system'),
  agent('interactive-visual-designer', 'Interactive Visual Designer', 'system'),
];
const health = agent('u-health', 'Health plan analyst', 'user', {
  description: 'Answers questions about the 2026 health plan',
});
const claims = agent('u-claims', 'Claims triage', 'user', {
  description: 'Sorts incoming claims by urgency',
});

const all = [health, ...system, assistant, claims];

function keys(agents: Agent[]): string[] {
  return agents.map((a) => a.key);
}

describe('matchesQuery', () => {
  it('matches the trimmed query in the name or description, ignoring case', () => {
    expect(matchesQuery(claims, '  URGENCY ')).toBeTrue();
    expect(matchesQuery(health, 'health plan')).toBeTrue();
    expect(matchesQuery(health, 'urgency')).toBeFalse();
    expect(matchesQuery(health, '   ')).toBeTrue();
  });
});

describe('buildHubSections', () => {
  it('shows Official, Mine and System under All, each sorted by name', () => {
    const sections = buildHubSections(all, 'all', '');
    expect(sections.map((s) => s.id)).toEqual(['official', 'mine', 'system']);
    expect(sections.map((s) => s.label)).toEqual([
      'Official',
      'Mine',
      'System',
    ]);
    expect(keys(sections[1].agents)).toEqual(['u-claims', 'u-health']);
    expect(keys(sections[2].agents)).toEqual([
      'assistant-eval-judge',
      'interactive-visual-designer',
      'knowledge-bootstrap',
      'sql-fixer',
      'sql-verifier',
    ]);
  });

  it('omits empty sections, so Mine is gone without user agents', () => {
    const sections = buildHubSections([assistant, ...system], 'all', '');
    expect(sections.map((s) => s.id)).toEqual(['official', 'system']);
  });

  it('keeps a pinned agent in its own section, first, and adds no Pinned section', () => {
    const pinnedHealth = { ...health, pinned: true };
    const pinnedFixer = { ...system[2], pinned: true };
    const sections = buildHubSections(
      [
        pinnedHealth,
        claims,
        assistant,
        ...system.filter((a) => a.key !== 'sql-fixer'),
        pinnedFixer,
      ],
      'all',
      '',
    );
    expect(sections.map((s) => s.id)).toEqual(['official', 'mine', 'system']);
    expect(keys(sections[1].agents)).toEqual(['u-health', 'u-claims']);
    expect(keys(sections[2].agents)[0]).toBe('sql-fixer');
  });

  it('lists every pinned agent under Pinned, by kind then name', () => {
    const sections = buildHubSections(
      [
        { ...system[0], pinned: true },
        { ...health, pinned: true },
        { ...claims, pinned: true },
        { ...assistant, pinned: true },
      ],
      'pinned',
      '',
    );
    expect(sections.map((s) => s.id)).toEqual(['pinned']);
    expect(sections[0].label).toBe('Pinned');
    expect(keys(sections[0].agents)).toEqual([
      'assistant',
      'u-claims',
      'u-health',
      'sql-verifier',
    ]);
  });

  it('limits Official to the assistant and Mine to user agents', () => {
    const official = buildHubSections(all, 'official', '');
    expect(official.map((s) => s.id)).toEqual(['official']);
    expect(keys(official[0].agents)).toEqual(['assistant']);

    const mine = buildHubSections(
      [{ ...health, pinned: true }, ...all.slice(1)],
      'mine',
      '',
    );
    expect(mine.map((s) => s.id)).toEqual(['mine']);
    expect(keys(mine[0].agents)).toEqual(['u-health', 'u-claims']);
  });

  it('combines search with the filter', () => {
    expect(
      buildHubSections(all, 'mine', 'urgency').map((s) => keys(s.agents)),
    ).toEqual([['u-claims']]);
    expect(buildHubSections(all, 'official', 'urgency')).toEqual([]);
    const searched = buildHubSections(all, 'all', 'sql');
    expect(searched.map((s) => s.id)).toEqual(['system']);
  });

  it('shows each agent exactly once in every view', () => {
    const pinnedAll = all.map((a) => ({ ...a, pinned: true }));
    for (const filter of ['all', 'pinned', 'official', 'mine'] as const) {
      const shown = buildHubSections(pinnedAll, filter, '').flatMap((s) =>
        keys(s.agents),
      );
      expect(new Set(shown).size).toBe(shown.length);
    }
  });
});

describe('visibleCards', () => {
  it('shows the first row and counts the hidden cards until expanded', () => {
    const [, , systemSection] = buildHubSections(all, 'all', '');
    expect(HUB_ROW_SIZE).toBe(3);
    const collapsed = visibleCards(systemSection.agents, false);
    expect(collapsed.shown.length).toBe(3);
    expect(collapsed.hidden).toBe(2);
    const expanded = visibleCards(systemSection.agents, true);
    expect(expanded.shown.length).toBe(5);
    expect(expanded.hidden).toBe(2);
    expect(visibleCards([assistant], false).hidden).toBe(0);
  });
});

describe('hubEmptyMessage', () => {
  it('prefers the no-match message whenever a query is typed', () => {
    expect(hubEmptyMessage('pinned', ' nothing here ', [])).toBe(
      'No agents match "nothing here"',
    );
    expect(hubEmptyMessage('mine', 'x', [])).toBe('No agents match "x"');
  });

  it('explains an empty Pinned or Mine filter', () => {
    expect(hubEmptyMessage('pinned', '', [])).toBe('No pinned agents yet.');
    expect(hubEmptyMessage('mine', '', [])).toBe('No agents of yours yet.');
  });

  it('says nothing when sections are shown', () => {
    expect(
      hubEmptyMessage('all', 'sql', buildHubSections(all, 'all', 'sql')),
    ).toBeNull();
  });
});

describe('canStartChat', () => {
  const live: Agent = { ...health, status: 'live', datasets: ['Core'] };

  it('offers Start chat for the Official agent and Live user agents', () => {
    expect(canStartChat(assistant)).toBeTrue();
    expect(canStartChat(live)).toBeTrue();
    expect(canStartChat({ ...live, hasUnpublishedChanges: true })).toBeTrue();
  });

  it('never offers it for drafts or System agents', () => {
    expect(canStartChat(health)).toBeFalse();
    for (const helper of system) expect(canStartChat(helper)).toBeFalse();
  });
});

describe('startChatBlockedReason', () => {
  const live: Agent = {
    ...health,
    status: 'live',
    datasets: ['Core', 'Claims'],
  };

  it('blocks a user agent none of whose datasets exist', () => {
    expect(
      startChatBlockedReason({ ...live, missingDatasets: ['Core', 'Claims'] }),
    ).toBe(NO_DATASETS_LEFT);
  });

  it('allows a user agent with at least one dataset left', () => {
    expect(startChatBlockedReason(live)).toBeNull();
    expect(
      startChatBlockedReason({ ...live, missingDatasets: ['Claims'] }),
    ).toBeNull();
  });

  it('never blocks the Official agent, which has no datasets', () => {
    expect(startChatBlockedReason(assistant)).toBeNull();
  });
});

describe('RFP Builder start chat', () => {
  const rfp: Agent = {
    ...agent('rfp', 'RFP Builder', 'official'),
    datasets: ['Intellify RFP API'],
    chatRequirement: 'Load the sample first',
  };

  it('is blocked with the requirement while its dataset is missing', () => {
    expect(
      startChatBlockedReason({
        ...rfp,
        missingDatasets: ['Intellify RFP API'],
      }),
    ).toBe('Load the sample first');
    expect(startChatBlockedReason(rfp)).toBeNull();
  });

  it('creates the session from the agent; the assistant opens the composer', () => {
    expect(startsInComposer(rfp)).toBe(false);
    expect(startsInComposer(agent('assistant', 'A', 'official'))).toBe(true);
  });
});

describe('newSessionAgentOptions (New conversation Agent picker)', () => {
  const rfp: Agent = {
    ...agent('rfp', 'RFP Builder', 'official'),
    datasets: ['Intellify RFP API'],
    chatRequirement: 'Load the sample first',
  };
  const live = (name: string, extra: Partial<Agent> = {}): Agent => ({
    ...agent(name.toLowerCase(), name, 'user'),
    status: 'live',
    datasets: ['Core'],
    ...extra,
  });

  it('lists the Official agents with a dataset, then Live agents, alphabetical', () => {
    const options = newSessionAgentOptions([
      live('Zeta'),
      agent('assistant', 'Assistant', 'official'),
      live('Alpha'),
      agent('planner', 'Planner', 'system'),
      { ...live('Draft one'), status: 'draft' },
      rfp,
    ]);
    expect(options.map((o) => o.agent.name)).toEqual([
      'RFP Builder',
      'Alpha',
      'Zeta',
    ]);
    expect(options.every((o) => o.disabledReason === null)).toBe(true);
  });

  it('keeps an agent that cannot start listed, with its reason', () => {
    const options = newSessionAgentOptions([
      { ...rfp, missingDatasets: ['Intellify RFP API'] },
      live('Scratch', { missingDatasets: ['Core'] }),
    ]);
    expect(options.map((o) => o.disabledReason)).toEqual([
      'Load the sample first',
      NO_DATASETS_LEFT,
    ]);
  });
});

describe('showcase agents (agents-evals R106)', () => {
  const reason = 'Showcase agent: not available to chat yet.';
  const survey: Agent = {
    ...agent('survey', 'Survey Agent', 'official'),
    datasets: [],
    showcase: true,
    chatRequirement: reason,
  };

  it('blocks Start chat with the showcase reason, without opening the composer', () => {
    expect(canStartChat(survey)).toBeTrue();
    expect(startChatBlockedReason(survey)).toBe(reason);
    expect(startsInComposer(survey)).toBeFalse();
  });

  it('puts showcase agents after the Official agents that can chat', () => {
    const lad: Agent = { ...survey, key: 'lad-coe', name: 'LAD COE Agent' };
    const [official] = buildHubSections([survey, assistant, lad], 'all', '');
    expect(official.agents.map((a) => a.key)).toEqual([
      assistant.key,
      'lad-coe',
      'survey',
    ]);
  });

  it('lists a showcase agent in the Agent picker, disabled with its reason', () => {
    const rfp: Agent = {
      ...agent('rfp', 'RFP Builder', 'official'),
      datasets: ['Intellify RFP API'],
    };
    const options = newSessionAgentOptions([assistant, survey, rfp]);
    expect(options.map((option) => option.agent.key)).toEqual([
      'rfp',
      'survey',
    ]);
    expect(options[1].disabledReason).toBe(reason);
  });
});
