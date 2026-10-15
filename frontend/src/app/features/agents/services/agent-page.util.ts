import { AgentConfig, AgentKind, SaveAgentInput } from './agents-api.service';
import {
  AgentForm,
  agentFormFromConfig,
  agentSaveInput,
} from './agent-editor.util';
import { LinkKind, promptSegments } from './prompt-links';

export type AgentTabId =
  | 'chat'
  | 'prompt'
  | 'skills'
  | 'tools'
  | 'graph'
  | 'memory'
  | 'evals'
  | 'model';

/** The tabs of the agent page, in order (agents-evals R86). */
export const AGENT_TAB_ORDER: { id: AgentTabId; label: string }[] = [
  { id: 'chat', label: 'Chat Box' },
  { id: 'prompt', label: 'System Prompt' },
  { id: 'skills', label: 'Skills' },
  { id: 'tools', label: 'Tools' },
  { id: 'graph', label: 'Graph' },
  { id: 'memory', label: 'Memory' },
  { id: 'evals', label: 'Evals' },
  { id: 'model', label: 'LLM Config' },
];

/** The tab an agent's page opens on: the chat, or the prompt for System agents. */
export function defaultAgentTab(kind: AgentKind, showcase = false): AgentTabId {
  return hasChatTab(kind, showcase) ? 'chat' : 'prompt';
}

/** System agents and showcase agents (R106) have no Chat Box. */
export function hasChatTab(kind: AgentKind, showcase = false): boolean {
  return kind !== 'system' && !showcase;
}

/** The tab ids shown for an agent kind, in order. */
export function agentTabIds(kind: AgentKind, showcase = false): AgentTabId[] {
  return AGENT_TAB_ORDER.filter(
    (tab) => tab.id !== 'chat' || hasChatTab(kind, showcase),
  ).map((tab) => tab.id);
}

export interface DraftLink {
  kind: LinkKind;
  name: string;
  exists: boolean;
}

/** The distinct links of a text, with whether each one exists. */
export function draftLinks(
  text: string,
  known: ReadonlySet<string>,
): DraftLink[] {
  const seen = new Set<string>();
  const links: DraftLink[] = [];
  for (const segment of promptSegments(text)) {
    if (segment.kind === 'text') continue;
    const id = `${segment.kind}:${segment.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({
      kind: segment.kind,
      name: segment.name,
      exists: known.has(id),
    });
  }
  return links;
}

/** The links to something that does not exist. */
export function brokenLinks(links: DraftLink[]): DraftLink[] {
  return links.filter((link) => !link.exists);
}

/** The error under the editor for broken links; null when there is none. */
export function brokenLinkMessage(broken: DraftLink[]): string | null {
  if (broken.length === 0) return null;
  const first = broken[0];
  const more = broken.length > 1 ? ' (and others)' : '';
  return `No ${first.kind} named ${first.name}${more}. Remove the link or create the skill on the Skills tab.`;
}

/** The draft as `PUT /agents/:id/draft` takes it, with new instructions only. */
export function promptSaveInput(
  config: AgentConfig,
  instructions: string,
): SaveAgentInput {
  const form: AgentForm = { ...agentFormFromConfig(config), instructions };
  return agentSaveInput(form);
}

/** Whether the skill is linked from the draft's instructions. */
export function skillLinked(instructions: string, name: string): boolean {
  return promptSegments(instructions).some(
    (segment) => segment.kind === 'skill' && segment.name === name,
  );
}

/**
 * The agents every user agent builds on: their built-in skills are the ones
 * "included in every agent" (agents-evals R75). An Official agent's own
 * skills, such as the RFP Builder's stages, are not.
 */
const EVERY_AGENT_SKILL_OWNERS = new Set(['assistant', 'visualization']);

/** The built-in skills every agent gets (R75), out of `GET /skills/built-in`. */
export function includedInEveryAgent<T extends { agents: string[] }>(
  skills: readonly T[],
): T[] {
  return skills.filter((skill) =>
    skill.agents.some((agent) => EVERY_AGENT_SKILL_OWNERS.has(agent)),
  );
}

/** The `Skills (<n>)` count: linked skills that exist, plus built-ins. */
export function skillsCount(
  instructions: string,
  library: { name: string }[],
  builtInCount: number,
): number {
  const names = new Set(library.map((skill) => skill.name));
  const linked = new Set<string>();
  for (const segment of promptSegments(instructions)) {
    if (segment.kind === 'skill' && names.has(segment.name)) {
      linked.add(segment.name);
    }
  }
  return linked.size + builtInCount;
}
