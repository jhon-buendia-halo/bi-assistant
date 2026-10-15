import { appSkillFile } from '../../mastra/app-skills';

/** The harness-loaded skill that holds the deep-analysis prompts. */
export const DEEP_ANALYSIS_SKILL = 'deep-analysis';

/** One phase file per call, in the order `SKILL.md` maps them. */
export const DEEP_ANALYSIS_PHASES = {
  plan: 'phases/1-plan.md',
  investigate: 'phases/2-investigate.md',
  report: 'phases/3-report.md',
} as const;

export type DeepAnalysisPhase = keyof typeof DEEP_ANALYSIS_PHASES;

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/**
 * Replace every `{{name}}` token in `template` with `values[name]`, in one
 * pass: values are inserted verbatim (no `$` patterns) and never re-scanned,
 * so a question that contains `{{…}}` reaches the model unchanged. Throws
 * when the template names a placeholder `values` does not fill, or lacks one
 * that `values` requires.
 */
export function fillPlaceholders(
  template: string,
  values: Readonly<Record<string, string>>,
  source: string,
): string {
  for (const name of Object.keys(values)) {
    if (!template.includes(`{{${name}}}`)) {
      throw new Error(`${source} has no {{${name}}} placeholder`);
    }
  }
  return template.replace(PLACEHOLDER, (_token, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`${source} has an unfilled placeholder {{${name}}}`);
    }
    return values[name];
  });
}

/**
 * The prompt for one deep-analysis call: its phase file, read from the
 * bundled skill, with the file's final newline dropped and its placeholders
 * filled.
 */
export function phasePrompt(
  phase: DeepAnalysisPhase,
  values: Readonly<Record<string, string>>,
): string {
  const path = DEEP_ANALYSIS_PHASES[phase];
  const template = appSkillFile(DEEP_ANALYSIS_SKILL, path)
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');
  return fillPlaceholders(
    template,
    values,
    `${DEEP_ANALYSIS_SKILL} phase ${path}`,
  );
}
