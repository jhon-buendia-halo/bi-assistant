import type { SkillFile } from './skill.entity';

/** One document in the `skill_overrides` collection (data-model 3.10.2). */
export interface SkillOverrideDoc {
  /** The built-in skill's name. */
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  /** SHA-256 of the shipped built-in it was saved against. */
  baseHash: string;
  /** The id of the user who saved it. */
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `BuiltInSkillSummary` of api.md 99. */
export interface BuiltInSkillSummary {
  name: string;
  /** As served. */
  description: string;
  loading: 'on-demand' | 'harness';
  /** Registry keys (agents.md 7.4). */
  agents: string[];
  modified: boolean;
  /** Modified, and the shipped built-in's hash differs from `baseHash`. */
  builtInChanged: boolean;
  /** The override's, or null. */
  updatedAt: string | null;
}

/** `BuiltInSkill` of api.md 100. */
export interface BuiltInSkill extends BuiltInSkillSummary {
  /** As served. */
  body: string;
  files: SkillFile[];
  /** As shipped. */
  builtIn: { description: string; body: string; files: SkillFile[] };
}

/** The untyped PUT payload (api.md 101). */
export interface BuiltInSkillInput {
  description?: unknown;
  body?: unknown;
  files?: unknown;
}
