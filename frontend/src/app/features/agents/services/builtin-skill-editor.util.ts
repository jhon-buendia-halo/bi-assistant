import {
  BuiltInSkill,
  BuiltInSkillSummary,
  SaveBuiltInSkillInput,
  SkillFile,
} from './skills-api.service';

/** The built-in skill editor's form: no name, and a fixed set of files. */
export interface BuiltInSkillForm {
  description: string;
  body: string;
  files: SkillFile[];
}

export function emptyBuiltInForm(): BuiltInSkillForm {
  return { description: '', body: '', files: [] };
}

export function builtInFormFromSkill(skill: BuiltInSkill): BuiltInSkillForm {
  return {
    description: skill.description,
    body: skill.body,
    files: skill.files.map((file) => ({ ...file })),
  };
}

/** Whether the form differs from the saved one (paths never change). */
export function builtInFormChanged(
  form: BuiltInSkillForm,
  saved: BuiltInSkillForm,
): boolean {
  return (
    form.description.trim() !== saved.description.trim() ||
    form.body !== saved.body ||
    form.files.length !== saved.files.length ||
    form.files.some((file, i) => file.content !== saved.files[i].content)
  );
}

/** Save needs Edit policies, changes and no save in flight (R76). */
export function canSaveBuiltIn(state: {
  canEdit: boolean;
  changed: boolean;
  saving: boolean;
}): boolean {
  return state.canEdit && state.changed && !state.saving;
}

export function builtInSaveInput(
  form: BuiltInSkillForm,
): SaveBuiltInSkillInput {
  return {
    description: form.description.trim(),
    body: form.body,
    files: form.files.map((file) => ({ ...file })),
  };
}

export function builtInResetConfirm(name: string): string {
  return `Reset "${name}" to the built-in version?`;
}

export const BUILT_IN_BANNER =
  'Changes apply to every session and agent as soon as you save. Run the evals to check them.';

export const BUILT_IN_DRIFT_NOTICE =
  "The app's built-in version changed since this was edited. Review it, then save again or reset.";

export function loadingChipLabel(loading: 'on-demand' | 'harness'): string {
  return loading === 'harness' ? 'Loaded by the app' : 'On demand';
}

/** The drift notice a library row shows (R79), or null. */
export function builtInRowNotice(skill: BuiltInSkillSummary): string | null {
  return skill.modified && skill.builtInChanged ? BUILT_IN_DRIFT_NOTICE : null;
}
