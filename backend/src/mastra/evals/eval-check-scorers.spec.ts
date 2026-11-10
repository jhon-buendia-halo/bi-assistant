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
import { checkContext, toAssistantEvalSets } from './eval-check-scorers';
import { usesEntities } from './checks/uses-entities';
import type { CheckTurn } from './checks';

describe('toAssistantEvalSets criteria (agents-evals R146)', () => {
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

describe('checkContext (agents-evals R124)', () => {
  const definitions = loadEvalSets();

  /** A turn whose one successful query is `sql`. */
  const turn = (sql: string): CheckTurn => ({
    question: 'What was the score of the 2018 World Cup final?',
    answer: 'France beat Croatia 4-2.',
    toolCalls: [
      {
        name: 'run_readonly_sql',
        args: { sql, rationale: 'Read the final.' },
        argsReadable: true,
        result: { rows: [] },
      },
    ],
  });

  it('opens the World Cup views for final-score-2018 on every datasource kind (BA-188)', () => {
    for (const [setId, view] of [
      ['world-cup', 'world_cup.v_match_results'],
      ['world-cup-rest', 'api.world_cup.v_match_results'],
      ['world-cup-databricks', '`evals`.world_cup.v_match_results'],
    ]) {
      const set = definitions.find((candidate) => candidate.id === setId);
      const evalCase = set?.cases.find((candidate) =>
        candidate.id.endsWith('final-score-2018'),
      );
      if (!set || !evalCase) throw new Error(`no final-score-2018 in ${setId}`);
      const sql = `SELECT home_team, away_team, home_goals, away_goals FROM ${view} WHERE tournament_year = 2018 AND LOWER(stage) = 'final'`;
      expect([
        setId,
        usesEntities.evaluate(turn(sql), {}, checkContext(set, evalCase)),
      ]).toEqual([setId, { passed: true }]);
    }
  });
});
