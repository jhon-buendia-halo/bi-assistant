import { Agent, AgentDomain, AgentKind } from './agents-api.service';
import { AGENT_DOMAINS, agentDomain } from './agent-domains';

/** The hub's filter pills: All, Pinned or one domain (agents-evals R2). */
export type HubFilter = 'all' | 'pinned' | AgentDomain;

/** The owner menu next to the pills (agents-evals R2). */
export type OwnerFilter = 'any' | 'official' | 'mine' | 'system';

export type HubSectionId = AgentDomain | 'pinned';

export interface HubSection {
  id: HubSectionId;
  label: string;
  agents: Agent[];
}

export const OWNER_FILTERS: { id: OwnerFilter; label: string }[] = [
  { id: 'any', label: 'Any owner' },
  { id: 'official', label: 'Official' },
  { id: 'mine', label: 'Mine' },
  { id: 'system', label: 'System' },
];

const OWNER_KIND: Record<Exclude<OwnerFilter, 'any'>, AgentKind> = {
  official: 'official',
  mine: 'user',
  system: 'system',
};

/**
 * The pills: All, Pinned, then one per domain that has at least one agent,
 * in domain order (R1, R2). Built from every agent, so the pills do not move
 * as the user types a search or changes the owner.
 */
export function hubFilters(agents: Agent[]): { id: HubFilter; label: string }[] {
  const present = new Set(agents.map(agentDomain));
  return [
    { id: 'all', label: 'All' },
    { id: 'pinned', label: 'Pinned' },
    ...AGENT_DOMAINS.filter((domain) => present.has(domain.id)).map(
      (domain) => ({ id: domain.id, label: domain.label }),
    ),
  ];
}

/** The agent's kind, falling back for a catalogue entry that predates kinds. */
export function agentKind(agent: Agent): AgentKind {
  if (agent.kind) return agent.kind;
  return agent.key === 'assistant' ? 'official' : 'system';
}

/** Search matches the trimmed query in the name or description, any case (R2). */
export function matchesQuery(agent: Agent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    agent.name.toLowerCase().includes(needle) ||
    (agent.description ?? '').toLowerCase().includes(needle)
  );
}

function matchesOwner(agent: Agent, owner: OwnerFilter): boolean {
  return owner === 'any' || agentKind(agent) === OWNER_KIND[owner];
}

const KIND_ORDER: Record<AgentKind, number> = {
  official: 0,
  user: 1,
  system: 2,
};

function byName(a: Agent, b: Agent): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function byKindThenName(a: Agent, b: Agent): number {
  return KIND_ORDER[agentKind(a)] - KIND_ORDER[agentKind(b)] || byName(a, b);
}

/** Pinned cards first, then Official, Mine and System, each by name (R1). */
function pinnedFirst(a: Agent, b: Agent): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  return byKindThenName(a, b);
}

/**
 * The sections the hub shows for a filter, owner and search (R1, R2): one per
 * domain under All, the chosen domain's alone, or a single Pinned section.
 * Each agent appears at most once; empty sections are omitted.
 */
export function buildHubSections(
  agents: Agent[],
  filter: HubFilter,
  owner: OwnerFilter,
  query: string,
): HubSection[] {
  const matching = agents.filter(
    (agent) => matchesQuery(agent, query) && matchesOwner(agent, owner),
  );

  if (filter === 'pinned') {
    const pinned = matching
      .filter((agent) => agent.pinned)
      .sort(byKindThenName);
    return pinned.length
      ? [{ id: 'pinned', label: 'Pinned', agents: pinned }]
      : [];
  }

  return AGENT_DOMAINS.filter(
    (domain) => filter === 'all' || domain.id === filter,
  )
    .map((domain) => ({
      id: domain.id,
      label: domain.label,
      agents: matching
        .filter((agent) => agentDomain(agent) === domain.id)
        .sort(pinnedFirst),
    }))
    .filter((section) => section.agents.length > 0);
}

/** The message shown instead of sections, or null when sections show (R2). */
export function hubEmptyMessage(
  filter: HubFilter,
  owner: OwnerFilter,
  query: string,
  sections: HubSection[],
): string | null {
  if (sections.length > 0) return null;
  const trimmed = query.trim();
  if (trimmed) return `No agents match "${trimmed}"`;
  if (filter === 'pinned') return 'No pinned agents yet.';
  if (owner === 'mine' && filter === 'all') return 'No agents of yours yet.';
  return 'No agents match these filters.';
}
