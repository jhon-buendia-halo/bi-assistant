import { BadRequestException } from '@nestjs/common';
import {
  type ShippedBuiltIn,
  missingFileProblem,
  placeholderProblem,
} from '../../mastra/app-skills';
import { SKILL_LIMITS, type SkillFile } from './entities/skill.entity';
import type { BuiltInSkillInput } from './entities/skill-override.entity';

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function refuse(message: string): never {
  throw new BadRequestException(message);
}

export interface OverrideFields {
  description: string;
  body: string;
  files: SkillFile[];
}

/**
 * Coerce and validate a PUT /skills/built-in/:name payload (api.md 101,
 * ADR-0022). The description is trimmed. The file checks are the ones a
 * folder override passes (ADR-0019), shared through `app-skills`; the first
 * refusal that applies is thrown, so a broken override never reaches a call.
 */
export function validateOverride(
  input: BuiltInSkillInput,
  shipped: ShippedBuiltIn,
): OverrideFields {
  const description = text(input?.description).trim();
  const body = text(input?.body);
  const files: SkillFile[] = Array.isArray(input?.files)
    ? (input.files as unknown[]).map((entry) => {
        const file = (entry ?? {}) as { path?: unknown; content?: unknown };
        return { path: text(file.path).trim(), content: text(file.content) };
      })
    : [];

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
  const expected = new Set(shipped.files.map((file) => file.path));
  for (const file of files) {
    if (!expected.has(file.path)) {
      refuse(`${file.path} is not a file of this skill`);
    }
  }
  const given = new Map(files.map((file) => [file.path, file]));
  for (const { path } of shipped.files) {
    if (!given.has(path)) refuse(missingFileProblem(path));
  }
  for (const file of files) {
    if (file.content.length > SKILL_LIMITS.fileContent) {
      refuse(`"${file.path}" is at most 20,000 characters`);
    }
  }
  const stored: SkillFile[] = [];
  for (const { path, content } of shipped.files) {
    const file = given.get(path) as SkillFile;
    const problem = placeholderProblem(path, content, file.content);
    if (problem) refuse(problem);
    stored.push(file);
  }
  // Stored in the built-in's order, so a save is stable.
  return { description, body, files: stored };
}
