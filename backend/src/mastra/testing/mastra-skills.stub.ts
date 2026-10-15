/**
 * Jest stand-in for `@mastra/core/skills` (mapped in package.json): the real
 * module pulls in ESM-only packages Jest cannot require. It builds the same
 * shape as Mastra 1.66's `createSkill` (inline skill with `references` keys
 * and `__referenceContents`) and refuses the same invalid names.
 */
export interface InlineSkillInput {
  name: string;
  description: string;
  instructions: string;
  references?: Record<string, string>;
}

export function createSkill(input: InlineSkillInput) {
  const { name, description, instructions, references } = input;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(`Invalid skill "${name}": name`);
  }
  if (!description || description.length > 1024) {
    throw new Error(`Invalid skill "${name}": description`);
  }
  return {
    __inline: true as const,
    __referenceContents: references ?? {},
    name,
    description,
    instructions,
    path: `inline/${name}`,
    references: Object.keys(references ?? {}),
    scripts: [] as string[],
    assets: [] as string[],
  };
}
