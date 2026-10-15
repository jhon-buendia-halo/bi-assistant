// `@mastra/evals/checks` and `@mastra/core/evals` pull in ESM-only packages
// Jest cannot require (see eval-set-files.spec.ts). These stand-ins build a scorer
// per check with the builder chain; only the criteria are under test here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy(
    {},
    {
      get: (_target, type) => () => ({
        id: `check-${String(type)}`,
        name: String(type),
        description: String(type),
      }),
    },
  ),
}));
jest.mock('@mastra/core/evals', () => ({
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));

import { loadEvalSets } from './eval-set-files';
import { toAssistantEvalSets } from './eval-check-scorers';

describe('toAssistantEvalSets criteria (agents-evals R145)', () => {
  const definitions = loadEvalSets();
  const sets = toAssistantEvalSets(definitions);

  it('gives every scorer the criterion of the check it was built from, in order', () => {
    sets.forEach((set, setIndex) => {
      set.cases.forEach((evalCase, caseIndex) => {
        const checks = definitions[setIndex].cases[caseIndex].checks;
        expect(evalCase.checkCriteria).toHaveLength(evalCase.scorers.length);
        expect(evalCase.checkCriteria).toEqual(
          checks.map((check) => check.criterion),
        );
      });
    });
  });

  it('keeps the category, so a run can report by category', () => {
    const champion = sets
      .find((set) => set.id === 'world-cup')
      ?.cases.find((evalCase) => evalCase.id === 'champion-2022');
    expect(champion).toMatchObject({ category: 'lookup', split: 'dev' });
    expect(champion?.checkCriteria?.[0]).toBe('G1');
  });
});
