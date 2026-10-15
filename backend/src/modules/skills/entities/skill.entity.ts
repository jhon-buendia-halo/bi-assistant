import type { AgentSkill, AgentSkillFile } from '../../../mastra/agent-skills';

/** A reference file of an in-app skill (data-model 3.10.1). */
export type SkillFile = AgentSkillFile;

/** One document in the `skills` collection (data-model 3.10.1). */
export interface SkillDoc {
  id: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  /** The owning user (data-model 3.15). */
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A skill as it was when an agent was published, embedded in
 * `agents.liveSkills`: the same shape a call carries (agents.md 4.2).
 */
export type SkillCopy = AgentSkill;

/** Limits from data-model 3.10.1. */
export const SKILL_LIMITS = {
  name: 64,
  description: 300,
  body: 20_000,
  files: 10,
  fileName: 100,
  fileContent: 20_000,
  /** An agent names at most this many skills (R43). */
  perAgent: 10,
} as const;

/** `SkillSummary` of api.md 94. */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  fileCount: number;
  /** Names of the caller's agents whose draft or Live version names it. */
  agents: string[];
  /** Tools its body links, sorted and distinct (ADR-0024). */
  tools: string[];
  updatedAt: string;
}

/** `Skill` of api.md 95. */
export interface Skill extends SkillSummary {
  body: string;
  files: SkillFile[];
}

/** The untyped create / save payload (api.md 96, 97). */
export interface SkillInput {
  name?: unknown;
  description?: unknown;
  body?: unknown;
  files?: unknown;
}

/** A copy of a skill document, as an agent's Live version keeps it. */
export function toSkillCopy(doc: SkillDoc): SkillCopy {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    body: doc.body,
    files: doc.files.map((file) => ({ ...file })),
  };
}

/** Whether two copies hold the same name, description, body and files. */
export function sameSkillContent(
  a: Pick<SkillCopy, 'name' | 'description' | 'body' | 'files'>,
  b: Pick<SkillCopy, 'name' | 'description' | 'body' | 'files'>,
): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.body === b.body &&
    a.files.length === b.files.length &&
    a.files.every(
      (file, i) =>
        file.path === b.files[i].path && file.content === b.files[i].content,
    )
  );
}
