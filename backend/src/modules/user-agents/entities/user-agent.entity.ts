import type { ReasoningEffort } from '../../llm/llm.types';
import type { OptionalAgentTool } from '../../../mastra/agent-tools';
import type { SkillCopy } from '../../skills/entities/skill.entity';

/** `official` = the assistant, `system` = the five helpers, `user` = built here. */
export type AgentKind = 'official' | 'system' | 'user';

/** Built-in agents are always `builtin`; a user agent is `live` once published. */
export type AgentStatus = 'builtin' | 'draft' | 'live';

export type AgentOwner = 'Official' | 'System' | 'You';

/** A user agent's configuration (data-model 3.10, rule R43). */
export interface AgentConfig {
  name: string;
  description: string;
  instructions: string;
  /** Dataset names, by value; they may dangle (data-model 3.13). */
  datasets: string[];
  starterQuestions: string[];
  /** A model or deployment name of the configured provider. */
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /**
   * The optional assistant tools the agent gets, de-duplicated and in
   * canonical order; absent means all three, empty means none (ADR-0022).
   */
  tools?: OptionalAgentTool[];
  /**
   * Ids of the owner's in-app skills (data-model 3.10.1), at most 10,
   * de-duplicated, in the order given; absent means none (ADR-0022).
   */
  skills?: string[];
}

/** One document in the `agents` collection. */
export interface UserAgentDoc {
  id: string;
  /** The working copy; always present. */
  draft: AgentConfig;
  /** The published copy; absent until the first publish. */
  live?: AgentConfig;
  /**
   * Copies of the skills the Live version names, taken at each publish, in
   * the order of `live.skills`; a Live agent runs on these (ADR-0022).
   */
  liveSkills?: SkillCopy[];
  publishedAt?: string;
  pinned: boolean;
  /** The owning user's id in org server mode (data-model 3.15). */
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const BUILTIN_AGENT_PINS_KEY = 'builtin-agent-pins';

/**
 * The `settings` document holding one user's pinned built-in agents' registry
 * keys: `builtin-agent-pins`, or `builtin-agent-pins:<user id>` on an org
 * server (data-model 3.2).
 */
export interface BuiltinAgentPinsDoc {
  key: string;
  pinned: string[];
}

/** Limits from R43. */
export const AGENT_LIMITS = {
  name: 64,
  description: 280,
  instructions: 4000,
  starterQuestions: 5,
  starterQuestion: 200,
} as const;
