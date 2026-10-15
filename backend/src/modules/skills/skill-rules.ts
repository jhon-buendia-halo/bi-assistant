import { BadRequestException } from '@nestjs/common';
import { isLibraryTool, parseLinks } from '../../mastra/agent-links';
import {
  SKILL_LIMITS,
  type SkillFile,
  type SkillInput,
} from './entities/skill.entity';

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REFERENCE_PREFIX = 'references/';

export interface SkillFields {
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
}

/** What the rules need to know about the caller's other skills. */
export interface SkillContext {
  /** Names of the built-in skills (agents.md 7.3). */
  builtIns: readonly string[];
  /** Whether another skill of the caller already has this name. */
  nameTaken: (name: string) => boolean;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function filesOf(value: unknown): SkillFile[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const file = (entry ?? {}) as { path?: unknown; content?: unknown };
    return { path: text(file.path).trim(), content: text(file.content) };
  });
}

/**
 * Every `references/<file name>` the body names, whatever the extension
 * (data-model 3.10.1). A trailing `.` ends a sentence, not the file name.
 */
function referencedPaths(body: string): string[] {
  const found: string[] =
    body.match(/\breferences\/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? [];
  return found.map((path) => path.replace(/\.+$/, ''));
}

function refuse(message: string): never {
  throw new BadRequestException(message);
}

/**
 * Coerce and validate a create / save payload (api.md 96, agents-evals
 * R68-R70). Name and description are trimmed. Checks run in the documented
 * order and the first that applies is thrown.
 */
export function validateSkill(
  input: SkillInput,
  context: SkillContext,
): SkillFields {
  const name = text(input?.name).trim();
  const description = text(input?.description).trim();
  const body = text(input?.body);
  const files = filesOf(input?.files);

  if (!name) refuse('Skill name is required');
  if (!NAME_PATTERN.test(name)) {
    refuse('Use lowercase letters, digits and single hyphens in a skill name');
  }
  if (name.length > SKILL_LIMITS.name) {
    refuse(`A skill name is at most ${SKILL_LIMITS.name} characters`);
  }
  if (context.builtIns.includes(name)) {
    refuse(`"${name}" is the name of a built-in skill`);
  }
  if (context.nameTaken(name)) {
    refuse(`A skill named "${name}" already exists`);
  }
  if (!description.startsWith('Use when')) {
    refuse('The description must start with "Use when"');
  }
  if (description.length > SKILL_LIMITS.description) {
    refuse(`The description is at most ${SKILL_LIMITS.description} characters`);
  }
  if (!body.trim()) refuse('The body is empty');
  if (body.length > SKILL_LIMITS.body) {
    refuse('The body is at most 20,000 characters');
  }
  if (files.length > SKILL_LIMITS.files) {
    refuse(`A skill has at most ${SKILL_LIMITS.files} reference files`);
  }
  for (const file of files) {
    const fileName = file.path.startsWith(REFERENCE_PREFIX)
      ? file.path.slice(REFERENCE_PREFIX.length)
      : '';
    if (
      !FILE_NAME_PATTERN.test(fileName) ||
      fileName.length > SKILL_LIMITS.fileName
    ) {
      refuse('Name reference files references/<file name>');
    }
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) {
      refuse(`Two reference files are named "${file.path}"`);
    }
    seen.add(file.path);
  }
  for (const file of files) {
    if (file.content.length > SKILL_LIMITS.fileContent) {
      refuse(`"${file.path}" is at most 20,000 characters`);
    }
  }
  const missing = referencedPaths(body).find((path) => !seen.has(path));
  if (missing) {
    refuse(`The body names ${missing}, which this skill doesn't have`);
  }
  // A body links tools only (ADR-0024).
  const links = parseLinks(body);
  if (links.skills.length) refuse('Skills can link tools only');
  const unknownTool = links.tools.find((tool) => !isLibraryTool(tool));
  if (unknownTool !== undefined) refuse(`Unknown tool "${unknownTool}"`);
  return { name, description, body, files };
}
