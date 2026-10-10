import { Agent, AgentKind } from './agents-api.service';

/** The hub's filter pills (agents-evals R2). */
export type HubFilter = 'all' | 'pinned' | 'official' | 'mine';

export type HubSectionId = 'official' | 'mine' | 'system' | 'pinned';

export interface HubSection {
  id: HubSectionId;
  label: string;
  agents: Agent[];
}

/** Cards per grid row; a section shows one row until expanded (R3). */
export const HUB_ROW_SIZE = 3;

export const HUB_FILTERS: { id: HubFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'official', label: 'Official' },
  { id: 'mine', label: 'Mine' },
];

/** The section of each kind of agent, in the order sections show (R1). */
const KIND_SECTIONS: { kind: AgentKind; id: HubSectionId; label: string }[] = [
  { kind: 'official', id: 'official', label: 'Official' },
  { kind: 'user', id: 'mine', label: 'Mine' },
  { kind: 'system', id: 'system', label: 'System' },
];

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

function byName(a: Agent, b: Agent): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Pinned cards first, then the others, each group alphabetical (R1). */
function pinnedFirst(a: Agent, b: Agent): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  return byName(a, b);
}

const KIND_ORDER: Record<AgentKind, number> = {
  official: 0,
  user: 1,
  system: 2,
};

/**
 * The sections the hub shows for a filter and search (R1, R2). Each agent
 * appears at most once; empty sections are omitted.
 */
export function buildHubSections(
  agents: Agent[],
  filter: HubFilter,
  query: string,
): HubSection[] {
  const matching = agents.filter((agent) => matchesQuery(agent, query));

  if (filter === 'pinned') {
    const pinned = matching
      .filter((agent) => agent.pinned)
      .sort(
        (a, b) =>
          KIND_ORDER[agentKind(a)] - KIND_ORDER[agentKind(b)] || byName(a, b),
      );
    return pinned.length
      ? [{ id: 'pinned', label: 'Pinned', agents: pinned }]
      : [];
  }

  const kinds: AgentKind[] =
    filter === 'official'
      ? ['official']
      : filter === 'mine'
        ? ['user']
        : ['official', 'user', 'system'];

  return KIND_SECTIONS.filter(({ kind }) => kinds.includes(kind))
    .map(({ kind, id, label }) => ({
      id,
      label,
      agents: matching
        .filter((agent) => agentKind(agent) === kind)
        .sort(pinnedFirst),
    }))
    .filter((section) => section.agents.length > 0);
}

/** The cards a section shows, and how many its first row hides (R3). */
export function visibleCards(
  agents: Agent[],
  expanded: boolean,
): { shown: Agent[]; hidden: number } {
  const hidden = Math.max(agents.length - HUB_ROW_SIZE, 0);
  return {
    shown: expanded ? agents : agents.slice(0, HUB_ROW_SIZE),
    hidden,
  };
}

/** The message shown instead of sections, or null when sections show (R2). */
export function hubEmptyMessage(
  filter: HubFilter,
  query: string,
  sections: HubSection[],
): string | null {
  if (sections.length > 0) return null;
  const trimmed = query.trim();
  if (trimmed) return `No agents match "${trimmed}"`;
  if (filter === 'pinned') return 'No pinned agents yet.';
  if (filter === 'mine') return 'No agents of yours yet.';
  return null;
}

/**
 * Start chat is offered for the Official agent and Live user agents, never
 * for drafts or System agents (agents-evals R53). A Live agent with
 * unpublished changes still offers it; the session uses the Live version.
 */
export function canStartChat(agent: Agent): boolean {
  const kind = agentKind(agent);
  return kind === 'official' || (kind === 'user' && agent.status === 'live');
}

/** Title of a disabled Start chat (R53, sessions-chat R52). */
export const NO_DATASETS_LEFT = "None of this agent's datasets exist";

/**
 * Why Start chat is disabled for an agent that offers it, or null when it can
 * run: a user agent none of whose datasets still exist (R53).
 */
export function startChatBlockedReason(agent: Agent): string | null {
  if (agentKind(agent) !== 'user') return null;
  const datasets = agent.datasets ?? [];
  const missing = agent.missingDatasets ?? [];
  return datasets.length > 0 && missing.length >= datasets.length
    ? NO_DATASETS_LEFT
    : null;
}
