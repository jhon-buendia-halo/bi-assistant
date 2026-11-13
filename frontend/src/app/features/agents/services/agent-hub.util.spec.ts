import { Agent, AgentDomain } from './agents-api.service';
import {
  buildHubSections,
  hubEmptyMessage,
  hubFilters,
  matchesQuery,
} from './agent-hub.util';

function agent(
  key: string,
  name: string,
  kind: 'official' | 'system' | 'user',
  domain: AgentDomain | undefined,
  options: { pinned?: boolean; description?: string } = {},
): Agent {
  return {
    key,
    id: key,
    name,
    ...(domain ? { domain } : {}),
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

const emily = agent('assistant', 'Emily', 'official', 'analysis');
const michael = agent('assistant-v2', 'Michael', 'official', 'analysis');
const sarah = agent('data-readiness', 'Sarah', 'official', 'data-foundations');
const olivia = agent('analysis-planner', 'Olivia', 'system', 'analysis');
const kevin = agent('knowledge-bootstrap', 'Kevin', 'system', 'data-foundations');
const david = agent('sql-fixer', 'David', 'system', 'sql');
const rachel = agent('sql-verifier', 'Rachel', 'system', 'sql');
const laura = agent('assistant-eval-judge', 'Laura', 'system', 'quality');
const health = agent('u-health', 'Health plan analyst', 'user', 'analysis', {
  description: 'Answers questions about the 2026 health plan',
});
// No domain chosen: General.
const claims = agent('u-claims', 'Claims triage', 'user', undefined, {
  description: 'Sorts incoming claims by urgency',
});

const builtins = [laura, rachel, olivia, emily, david, kevin, sarah, michael];
const all = [health, ...builtins, claims];

function keys(agents: Agent[]): string[] {
  return agents.map((a) => a.key);
}

function ids(sections: { id: string }[]): string[] {
  return sections.map((s) => s.id);
}

describe('matchesQuery', () => {
  it('matches the trimmed query in the name or description, ignoring case', () => {
    expect(matchesQuery(health, '  HEALTH ')).toBeTrue();
    expect(matchesQuery(claims, 'urgency')).toBeTrue();
    expect(matchesQuery(claims, 'health')).toBeFalse();
    expect(matchesQuery(claims, '   ')).toBeTrue();
  });
});

describe('hubFilters', () => {
  it('offers All, Pinned and the domains that have agents, in domain order', () => {
    expect(hubFilters(all).map((f) => f.label)).toEqual([
      'All',
      'Pinned',
      'Data Foundations',
      'Analysis',
      'SQL Engineering',
      'Quality & Evals',
      'General',
    ]);
    expect(hubFilters(builtins).map((f) => f.id)).not.toContain('general');
  });
});

describe('buildHubSections', () => {
  it('shows one section per domain under All, in domain order', () => {
    const sections = buildHubSections(all, 'all', 'any', '');
    expect(ids(sections)).toEqual([
      'data-foundations',
      'analysis',
      'sql',
      'quality',
      'general',
    ]);
    expect(sections.map((s) => s.label)).toEqual([
      'Data Foundations',
      'Analysis',
      'SQL Engineering',
      'Quality & Evals',
      'General',
    ]);
    // Official, then Mine, then System, each by name.
    expect(keys(sections[1].agents)).toEqual([
      'assistant',
      'assistant-v2',
      'u-health',
      'analysis-planner',
    ]);
    // A user agent with no domain is General.
    expect(keys(sections[4].agents)).toEqual(['u-claims']);
  });

  it('puts pinned cards first within their own domain and adds no Pinned section', () => {
    const pinnedOlivia = { ...olivia, pinned: true };
    const sections = buildHubSections(
      [emily, michael, pinnedOlivia],
      'all',
      'any',
      '',
    );
    expect(ids(sections)).toEqual(['analysis']);
    expect(keys(sections[0].agents)).toEqual([
      'analysis-planner',
      'assistant',
      'assistant-v2',
    ]);
  });

  it('lists every pinned agent under Pinned, by kind then name', () => {
    const sections = buildHubSections(
      [
        { ...rachel, pinned: true },
        { ...claims, pinned: true },
        { ...sarah, pinned: true },
        emily,
      ],
      'pinned',
      'any',
      '',
    );
    expect(ids(sections)).toEqual(['pinned']);
    expect(keys(sections[0].agents)).toEqual([
      'data-readiness',
      'u-claims',
      'sql-verifier',
    ]);
  });

  it('shows only the chosen domain under a domain filter', () => {
    const sections = buildHubSections(all, 'sql', 'any', '');
    expect(ids(sections)).toEqual(['sql']);
    expect(keys(sections[0].agents)).toEqual(['sql-fixer', 'sql-verifier']);
  });

  it('keeps only the chosen owner in every domain', () => {
    const official = buildHubSections(all, 'all', 'official', '');
    expect(ids(official)).toEqual(['data-foundations', 'analysis']);
    expect(official.flatMap((s) => keys(s.agents))).toEqual([
      'data-readiness',
      'assistant',
      'assistant-v2',
    ]);
    const mine = buildHubSections(all, 'all', 'mine', '');
    expect(mine.flatMap((s) => keys(s.agents))).toEqual([
      'u-health',
      'u-claims',
    ]);
    const system = buildHubSections(all, 'all', 'system', '');
    expect(system.flatMap((s) => s.agents).every((a) => a.kind === 'system'))
      .toBeTrue();
  });

  it('combines search, domain and owner', () => {
    expect(
      keys(buildHubSections(all, 'analysis', 'mine', 'health')[0].agents),
    ).toEqual(['u-health']);
    expect(buildHubSections(all, 'sql', 'official', '')).toEqual([]);
  });

  it('shows each agent exactly once in every view', () => {
    for (const filter of ['all', 'pinned', 'analysis'] as const) {
      for (const owner of ['any', 'official', 'mine', 'system'] as const) {
        const shown = buildHubSections(
          all.map((a, i) => ({ ...a, pinned: i % 2 === 0 })),
          filter,
          owner,
          '',
        ).flatMap((s) => keys(s.agents));
        expect(new Set(shown).size).toBe(shown.length);
      }
    }
  });
});

describe('hubEmptyMessage', () => {
  it('prefers the no-match message whenever a query is typed', () => {
    expect(hubEmptyMessage('pinned', 'mine', '  zzz ', [])).toBe(
      'No agents match "zzz"',
    );
  });

  it('explains an empty Pinned filter, no agents of yours, or a combination with nothing', () => {
    expect(hubEmptyMessage('pinned', 'any', '', [])).toBe(
      'No pinned agents yet.',
    );
    expect(hubEmptyMessage('all', 'mine', '', [])).toBe(
      'No agents of yours yet.',
    );
    expect(hubEmptyMessage('sql', 'official', '', [])).toBe(
      'No agents match these filters.',
    );
  });

  it('says nothing when sections are shown', () => {
    expect(
      hubEmptyMessage('all', 'any', '', buildHubSections(all, 'all', 'any', '')),
    ).toBeNull();
  });
});
