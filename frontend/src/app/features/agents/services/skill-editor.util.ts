import { SaveSkillInput, Skill, SkillFile } from './skills-api.service';

/** The R70 limits the skill editor's fields enforce as the user types. */
export const SKILL_FIELD_LIMITS = {
  name: 64,
  description: 300,
  body: 20000,
  fileContent: 20000,
  files: 10,
} as const;

/** The skill editor's form, as typed. */
export interface SkillForm {
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
}

export function emptySkillForm(): SkillForm {
  return { name: '', description: '', body: '', files: [] };
}

export function skillFormFromSkill(skill: Skill): SkillForm {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    files: skill.files.map((file) => ({ ...file })),
  };
}

/** Whether the form differs from the saved one. */
export function skillFormChanged(form: SkillForm, saved: SkillForm): boolean {
  return (
    form.name.trim() !== saved.name.trim() ||
    form.description.trim() !== saved.description.trim() ||
    form.body !== saved.body ||
    form.files.length !== saved.files.length ||
    form.files.some(
      (file, i) =>
        file.path.trim() !== saved.files[i].path.trim() ||
        file.content !== saved.files[i].content,
    )
  );
}

/** Save is enabled with a name, changes and no save in flight (R71). */
export function canSaveSkill(state: {
  form: SkillForm;
  changed: boolean;
  saving: boolean;
}): boolean {
  return state.changed && !state.saving && state.form.name.trim() !== '';
}

export function skillSaveInput(form: SkillForm): SaveSkillInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    body: form.body,
    files: form.files.map((file) => ({
      path: file.path.trim(),
      content: file.content,
    })),
  };
}

/** `Delete "<name>"?`, plus the warning when agents use the skill (R72). */
export function skillDeleteConfirm(name: string, usedBy: string[]): string {
  const question = `Delete "${name}"?`;
  return usedBy.length > 0
    ? `${question}\n\nAgents using it keep it in their Live version until republished.`
    : question;
}

/** The library row's right-hand text (R69). */
export function usedByLabel(agents: string[]): string {
  return agents.length > 0
    ? `Used by ${agents.join(', ')}`
    : 'Not used by any agent';
}
