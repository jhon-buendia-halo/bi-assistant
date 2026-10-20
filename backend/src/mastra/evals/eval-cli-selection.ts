/**
 * Which eval cases the CLI runs (agents.md 8.5). A pure function of the
 * environment, so a bad selection fails before the backend boots and before
 * any model call: a full run costs money, so there is no default.
 */
import { EVAL_CATEGORIES, EVAL_SPLITS } from './eval-set-files';

interface EvalSetIds {
  id: string;
  /** A case defined in code (the RFP Builder's) has no split or category. */
  cases: { id: string; split?: string; category?: string }[];
}

export type CliEvalSelection = { caseIds: string[] } | { error: string };

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function selectCliEvalCases(
  env: Readonly<Record<string, string | undefined>>,
  sets: readonly EvalSetIds[],
): CliEvalSelection {
  const setId = env['EVAL_SET']?.trim() ?? '';
  const caseIds = list(env['EVAL_CASES']);
  const known = sets.map((set) => set.id).join(', ');

  if (setId && caseIds.length) {
    return { error: 'Set EVAL_SET or EVAL_CASES, not both' };
  }
  if (setId) {
    const set = sets.find((candidate) => candidate.id === setId);
    return set
      ? { caseIds: set.cases.map((evalCase) => evalCase.id) }
      : { error: `Unknown question set "${setId}" (known: ${known})` };
  }
  if (caseIds.length) {
    const all = new Set(sets.flatMap((set) => set.cases.map((c) => c.id)));
    const unknown = caseIds.filter((id) => !all.has(id));
    return unknown.length
      ? { error: `Unknown eval case(s): ${unknown.join(', ')}` }
      : { caseIds };
  }
  return {
    error: `Set EVAL_SET to one question set (${known}) or EVAL_CASES to comma-separated case ids`,
  };
}

/**
 * Narrow a selection to `EVAL_SPLIT` (`dev` or `held-out`) and the
 * categories of `EVAL_CATEGORY` (comma-separated, blanks ignored), each
 * unset or blank for no filter (agents-evals R222). A case with no split is
 * `dev`; a case with no category matches no category. Refuses an unknown
 * split, an unknown category, and a filter that leaves no question.
 */
export function narrowCliEvalCases(
  env: Readonly<Record<string, string | undefined>>,
  sets: readonly EvalSetIds[],
  caseIds: readonly string[],
): CliEvalSelection {
  const split = env['EVAL_SPLIT']?.trim() ?? '';
  if (split && !(EVAL_SPLITS as readonly string[]).includes(split)) {
    return { error: `Unknown EVAL_SPLIT "${split}"; use dev or held-out` };
  }
  const categories = list(env['EVAL_CATEGORY']);
  const unknown = categories.find(
    (category) => !(EVAL_CATEGORIES as readonly string[]).includes(category),
  );
  if (unknown !== undefined) {
    return {
      error: `Unknown EVAL_CATEGORY "${unknown}". Known categories: ${EVAL_CATEGORIES.join(', ')}.`,
    };
  }
  if (!split && categories.length === 0) return { caseIds: [...caseIds] };

  const cases = new Map(
    sets.flatMap((set) => set.cases).map((evalCase) => [evalCase.id, evalCase]),
  );
  const kept = caseIds.filter((id) => {
    const evalCase = cases.get(id);
    return (
      (!split || (evalCase?.split ?? 'dev') === split) &&
      (categories.length === 0 ||
        (evalCase?.category !== undefined &&
          categories.includes(evalCase.category)))
    );
  });
  if (kept.length > 0) return { caseIds: kept };

  const setId = env['EVAL_SET']?.trim();
  const filters = [
    ...(split ? [`EVAL_SPLIT=${split}`] : []),
    ...(categories.length ? [`EVAL_CATEGORY=${categories.join(',')}`] : []),
  ];
  return {
    error: `No question of ${setId ? `set "${setId}"` : 'the listed cases'} matches ${filters.join(' ')}`,
  };
}
