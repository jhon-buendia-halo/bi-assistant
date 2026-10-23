/**
 * The judge run option (agents-evals R144 to R146, R154): whether a run calls
 * the LLM judge, off by default. The deterministic checks are the gate; the
 * judge costs tokens and can vary between runs, so a check it did not grade is
 * reported as not scored, never as a pass (BA-9 research 2.3).
 *
 * Pure module: no Nest, no Mastra, no model.
 */
import { EVAL_CATEGORIES } from './eval-set-files';
import type { EvalCategory, EvalCriterion } from './eval-set-files';

export const EVAL_JUDGE_MODES = ['off', 'on', 'categories'] as const;
export type EvalJudgeMode = (typeof EVAL_JUDGE_MODES)[number];

/** A run's judge option as it is recorded on the run. */
export interface EvalJudgeSetting {
  mode: EvalJudgeMode;
  /** Only with `categories`: the judged categories, in category-list order. */
  categories?: EvalCategory[];
}

/** The default: no judge call; every judge check is not scored. */
export const JUDGE_OFF: Readonly<EvalJudgeSetting> = Object.freeze({
  mode: 'off',
});

/** How a run saved before the option existed reads: every one was judged. */
export const LEGACY_JUDGE_SETTING: Readonly<EvalJudgeSetting> = Object.freeze({
  mode: 'on',
});

/** The reason on a judge check the run did not call (R145). */
export const JUDGE_OFF_REASON = 'Judge off for this run';

export type JudgeSettingResult =
  { setting: EvalJudgeSetting } | { error: string };

function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Read a judge option and its categories as the API receives them. Missing
 * (or `null`) means off; a category list is read only with `categories`.
 */
export function parseJudgeSetting(
  judge: unknown,
  categories: unknown,
): JudgeSettingResult {
  if (judge === undefined || judge === null)
    return { setting: { mode: 'off' } };
  if (
    typeof judge !== 'string' ||
    !EVAL_JUDGE_MODES.includes(judge as EvalJudgeMode)
  ) {
    return { error: `Unknown judge option "${shown(judge)}"` };
  }
  if (judge !== 'categories') {
    return { setting: { mode: judge as EvalJudgeMode } };
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return { error: 'Pick at least one category to judge' };
  }
  const wanted = new Set<string>();
  for (const value of categories as unknown[]) {
    if (
      typeof value !== 'string' ||
      !EVAL_CATEGORIES.includes(value as EvalCategory)
    ) {
      return {
        error: `Unknown judge category "${shown(value)}". Known categories: ${EVAL_CATEGORIES.join(', ')}.`,
      };
    }
    wanted.add(value);
  }
  return {
    setting: {
      mode: 'categories',
      categories: EVAL_CATEGORIES.filter((category) => wanted.has(category)),
    },
  };
}

/**
 * The command line's option: `EVAL_JUDGE` (unset or blank is off) and
 * `EVAL_JUDGE_CATEGORIES`, comma-separated with blanks ignored.
 */
export function judgeSettingFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): JudgeSettingResult {
  const judge = env['EVAL_JUDGE']?.trim();
  const categories = (env['EVAL_JUDGE_CATEGORIES'] ?? '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
  return parseJudgeSetting(judge ? judge : undefined, categories);
}

/** Whether the run's option lets the judge grade a question of this category. */
export function shouldJudge(
  setting: Readonly<EvalJudgeSetting> | undefined,
  category: string | undefined,
): boolean {
  if (setting?.mode === 'on') return true;
  if (setting?.mode === 'categories') {
    return (
      category !== undefined &&
      (setting.categories ?? []).includes(category as EvalCategory)
    );
  }
  return false;
}

/** What a rubric grades, by category (research 2.3, 2.5); G1 otherwise. */
const JUDGE_CRITERIA: Readonly<Partial<Record<EvalCategory, EvalCriterion>>> = {
  ambiguous: 'I5',
  'out-of-scope': 'G2',
  'non-existent': 'G2',
  reasoning: 'G3',
  visual: 'G4',
  'fuzzy-scope': 'I7',
  'default-filter': 'I2',
};

/** The criterion a judge check measures on a question of this category. */
export function judgeCriterion(category: string | undefined): EvalCriterion {
  return JUDGE_CRITERIA[category as EvalCategory] ?? 'G1';
}

/** `off`, `on` or `on for <categories>`, as the report and the CLI print it. */
export function judgeLabel(setting: Readonly<EvalJudgeSetting>): string {
  if (setting.mode === 'categories') {
    return `on for ${(setting.categories ?? []).join(', ')}`;
  }
  return setting.mode;
}
