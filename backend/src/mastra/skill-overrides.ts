/**
 * Bridge for the in-app overrides of built-in skills (ADR-0023, agents.md
 * 7.3). `app-skills.ts` is plain code with no Nest DI, so the skills
 * service installs the current overrides here when the app starts and
 * after every save or reset. Resolution reads them per call, so a change
 * applies to the next call without a restart.
 */

export interface SkillOverrideFile {
  path: string;
  content: string;
}

/** One override as resolution needs it (data-model 3.10.2). */
export interface SkillOverride {
  name: string;
  description: string;
  body: string;
  files: SkillOverrideFile[];
  baseHash: string;
  updatedAt?: string;
}

let overrides: ReadonlyMap<string, SkillOverride> = new Map();
let version = 0;

/** Replace every override (start-up load, or after a save or reset). */
export function setSkillOverrides(list: readonly SkillOverride[]): void {
  overrides = new Map(list.map((entry) => [entry.name, entry]));
  version += 1;
}

export function skillOverrideFor(name: string): SkillOverride | undefined {
  return overrides.get(name);
}

/** Changes whenever the overrides do: the key of anything built from them. */
export function skillOverridesVersion(): number {
  return version;
}
