// `@mastra/core/evals` pulls in ESM-only packages Jest cannot require. This
// stand-in keeps the builder's shape (`analyze` → `generateScore` →
// `generateReason`, then `run`) so the wrapper is tested as Mastra runs it.
jest.mock('@mastra/core/evals', () => ({
  createScorer: (config: { id: string; name: string; description: string }) => {
    const steps: Record<string, (context: any) => unknown> = {};
    const scorer = {
      ...config,
      analyze(fn: (context: any) => unknown) {
        steps.analyze = fn;
        return scorer;
      },
      generateScore(fn: (context: any) => unknown) {
        steps.score = fn;
        return scorer;
      },
      generateReason(fn: (context: any) => unknown) {
        steps.reason = fn;
        return scorer;
      },
      async run(run: unknown) {
        const analyzeStepResult = await steps.analyze({ run, results: {} });
        const results = { analyzeStepResult };
        const score = await steps.score({ run, results });
        const reason = await steps.reason({
          run,
          results: { ...results, generateScoreStepResult: score },
          score,
        });
        return { score, reason, analyzeStepResult };
      },
    };
    return scorer;
  },
}));

import { checkScorer } from './check-scorer';
import { DETERMINISTIC_CHECKS } from './index';
import type { DeterministicCheck } from './check';

/** What the stand-in's `run` returns. */
interface ScorerRunResult {
  score: number;
  reason: string;
  preprocessStepResult?: unknown;
}

/** A scorer run as `runEvals` hands it: input and output messages. */
function scorerRun(answer: string, invocations: Record<string, unknown>[]) {
  return {
    input: {
      inputMessages: [
        {
          id: 'u',
          role: 'user',
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [
              { type: 'text', text: 'Which team scored the most goals?' },
            ],
          },
        },
      ],
      rememberedMessages: [],
      systemMessages: [],
      taggedSystemMessages: {},
    },
    output: [
      {
        id: 'a',
        role: 'assistant',
        createdAt: new Date(),
        content: {
          format: 2,
          parts: [
            ...invocations.map((toolInvocation) => ({
              type: 'tool-invocation',
              toolInvocation,
            })),
            { type: 'text', text: answer },
          ],
        },
      },
    ],
  };
}

const goals = {
  state: 'result',
  toolCallId: 'c1',
  toolName: 'run_readonly_sql',
  args: {
    sql: 'SELECT t.common_name, COUNT(*) FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.scoring_team_id GROUP BY 1',
    rationale: 'I count the goals of each team to find the top scorer.',
  },
  result: { rows: [{ common_name: 'France', goals: 14 }] },
};

describe('checkScorer', () => {
  it('carries the check’s id, name and description', () => {
    const scorer = checkScorer(
      DETERMINISTIC_CHECKS.dialect,
      {},
      { dialect: 'sqlite' },
    ) as unknown as Record<string, unknown>;
    expect(scorer).toMatchObject({
      id: 'check-dialect',
      name: 'Dialect Check',
      description:
        'Checks that the SQL fits the SQLite (the REST connector) dialect',
    });
  });

  it('scores 1 with no reason when the check passes on the run', async () => {
    const scorer = checkScorer(
      DETERMINISTIC_CHECKS.numbersGrounded,
      {},
      { dialect: 'postgres' },
    ) as unknown as { run: (run: unknown) => Promise<ScorerRunResult> };
    await expect(
      scorer.run(scorerRun('France, with 14 goals.', [goals])),
    ).resolves.toMatchObject({ score: 1, reason: '' });
  });

  it('scores 0 with the check’s own reason, which the runner reports (no preprocess step)', async () => {
    const scorer = checkScorer(
      DETERMINISTIC_CHECKS.numbersGrounded,
      {},
      { dialect: 'postgres' },
    ) as unknown as { run: (run: unknown) => Promise<ScorerRunResult> };
    const result = await scorer.run(
      scorerRun('France, with 16 goals.', [goals]),
    );
    expect(result).toMatchObject({
      score: 0,
      reason:
        'the answer states 16, which no tool result of this turn holds or rounds to',
    });
    expect(result.preprocessStepResult).toBeUndefined();
  });

  it('fails, rather than aborting the run, when a check throws', async () => {
    const broken: DeterministicCheck = {
      type: 'broken',
      id: 'check-broken',
      name: 'Broken',
      args: { required: [], optional: [] },
      describe: () => 'Broken',
      evaluate: () => {
        throw new Error('bad input');
      },
    };
    const scorer = checkScorer(
      broken,
      {},
      { dialect: 'postgres' },
    ) as unknown as {
      run: (run: unknown) => Promise<ScorerRunResult>;
    };
    await expect(scorer.run(scorerRun('x', []))).resolves.toMatchObject({
      score: 0,
      reason: 'the check could not read the run: bad input',
    });
  });
});
