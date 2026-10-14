/**
 * Which eval cases the CLI runs (agents.md 8.5). A pure function of the
 * environment, so a bad selection fails before the backend boots and before
 * any model call: a full run costs money, so there is no default.
 */

interface EvalSetIds {
  id: string;
  cases: { id: string }[];
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
