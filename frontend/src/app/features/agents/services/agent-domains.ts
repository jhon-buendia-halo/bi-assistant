import {
  ChartLine,
  CodeXml,
  Database,
  LucideIconData,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from 'lucide-angular';
import { Agent, AgentDomain } from './agents-api.service';

export interface AgentDomainInfo {
  id: AgentDomain;
  label: string;
  /** The icon on the card's tile (ui.md 4.4). */
  icon: LucideIconData;
}

/**
 * The domains (specialties) the Agent Hub groups agents by, in the order its
 * sections show (agents-evals R1, agents.md 1.2). General holds the user
 * agents whose owner chose no domain.
 */
export const AGENT_DOMAINS: readonly AgentDomainInfo[] = [
  { id: 'data-foundations', label: 'Data Foundations', icon: Database },
  { id: 'analysis', label: 'Analysis', icon: ChartLine },
  { id: 'sql', label: 'SQL Engineering', icon: CodeXml },
  { id: 'storytelling', label: 'Storytelling', icon: MessageSquareText },
  { id: 'quality', label: 'Quality & Evals', icon: ShieldCheck },
  { id: 'general', label: 'General', icon: Sparkles },
];

const BY_ID = new Map(AGENT_DOMAINS.map((domain) => [domain.id, domain]));

/** The agent's domain; an unknown or missing one reads as General. */
export function agentDomain(agent: Pick<Agent, 'domain'>): AgentDomain {
  return agent.domain && BY_ID.has(agent.domain) ? agent.domain : 'general';
}

/** The domain's label, icon and position. */
export function domainInfo(id: AgentDomain): AgentDomainInfo {
  return BY_ID.get(id) ?? BY_ID.get('general')!;
}
