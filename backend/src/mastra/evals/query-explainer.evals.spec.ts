jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
// The cases' scorers are built at import; they never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant' },
}));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { Agent } from '@mastra/core/agent';
import { findFixture } from '../../modules/testing-data/fixtures/registry';
import type { QueryRerunResult } from '../../modules/sessions/query-evidence/query-evidence.service';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { QueryEvidence } from '../../modules/sessions/query-evidence/query-evidence.types';
import { explanationOf } from '../agents/query-explainer.prompts';
import { agentForCases, evalTargetFor, EVAL_SETS, hasEvals } from './eval-sets';
import { selectCliEvalCases } from './eval-cli-selection';
import { fixtureForCases } from './assistant.evals';
import {
  QUERY_EXPLAINER_EVAL_SET,
  queryExplainerEvalTarget,
  rationaleOfStatement,
} from './query-explainer.evals';
import {
  explainForEval,
  explainerTurnAgent,
  installQueryExplainerEvalServices,
  queryExplainerEvalServices,
  type ExplainerEvalServices,
} from './query-explainer-eval-target';
import {
  countsVerified,
  notFallback,
  startsFromATableItReads,
  textsInBusinessWords,
} from './query-explainer-eval-checks';

describe('query-explainer eval set (agents.md 8.1, 2.12)', () => {
  const cases = QUERY_EXPLAINER_EVAL_SET.cases;

  it('runs on query-explainer over the World Cup fixture', () => {
    expect(QUERY_EXPLAINER_EVAL_SET.id).toBe('query-explainer');
    expect(QUERY_EXPLAINER_EVAL_SET.agentKey).toBe('query-explainer');
    expect(findFixture(QUERY_EXPLAINER_EVAL_SET.fixtureId)?.schema).toBe(
      'world_cup',
    );
  });

  it('has the 8 statement shapes with ids unique across every set', () => {
    expect(cases).toHaveLength(8);
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    const text = cases.map((c) => c.question).join('\n');
    for (const shape of [
      /SUM\(/,
      /JOIN[\s\S]*GROUP BY/,
      /RANK\(\)/,
      /^WITH /m,
      /LIMIT 5/,
      /COUNT\(DISTINCT/,
      /HAVING/,
      /UNION/,
    ]) {
      expect(text).toMatch(shape);
    }
  });

  it('sends each statement over the world_cup schema, with its rationale', () => {
    for (const evalCase of cases) {
      expect(evalCase.question).toMatch(/^(SELECT|WITH) /);
      expect(evalCase.question).toContain('world_cup.');
      expect(evalCase.question).not.toContain(';');
      expect(rationaleOfStatement(evalCase.question)).toBeTruthy();
    }
    expect(rationaleOfStatement('SELECT 1')).toBeUndefined();
  });

  it('holds the four code checks and one rubric with the one pass condition', () => {
    for (const evalCase of cases) {
      expect((evalCase.customChecks ?? []).map((c) => c.id)).toEqual([
        'not-fallback',
        'starts-from-a-table-it-reads',
        'texts-in-business-words',
        'counts-verified',
      ]);
      expect(evalCase.intent.trim()).not.toBe('');
      expect(evalCase.judgeRubric).toContain(evalCase.question);
      expect(evalCase.judgeRubric).toMatch(
        /invent no filter and no table the query does not have/,
      );
    }
  });
});

describe('query-explainer registration', () => {
  const ids = QUERY_EXPLAINER_EVAL_SET.cases.map((c) => c.id);

  it('lists the set under the query-explainer agent only', () => {
    expect(hasEvals('query-explainer')).toBe(true);
    expect(
      EVAL_SETS.filter((set) => set.agentKey === 'query-explainer'),
    ).toEqual([QUERY_EXPLAINER_EVAL_SET]);
  });

  it('selects the set by EVAL_SET=query-explainer and names it in the errors', () => {
    expect(
      selectCliEvalCases({ EVAL_SET: 'query-explainer' }, EVAL_SETS),
    ).toEqual({ caseIds: ids });
    const none = selectCliEvalCases({}, EVAL_SETS);
    const unknown = selectCliEvalCases({ EVAL_SET: 'nope' }, EVAL_SETS);
    expect(none).toEqual({
      error: expect.stringContaining('query-explainer') as string,
    });
    expect(unknown).toEqual({
      error: expect.stringContaining('query-explainer') as string,
    });
  });

  it('maps its cases to the query-explainer agent', () => {
    expect(agentForCases(ids)).toEqual({ agentKey: 'query-explainer' });
  });

  it('binds the set to the World Cup fixture for the preflight', () => {
    expect(fixtureForCases(ids, EVAL_SETS).id).toBe('world-cup');
  });

  it('builds its target through evalTargetFor', () => {
    const target = evalTargetFor('query-explainer');
    expect(target.agentKey).toBe('query-explainer');
    expect(target.sets).toEqual([QUERY_EXPLAINER_EVAL_SET]);
    expect((target.agent as unknown as { id: string }).id).toBe(
      'query-explainer',
    );
  });
});

describe('query-explainer eval target', () => {
  const SQL = QUERY_EXPLAINER_EVAL_SET.cases[1].question;
  const TABLES = [
    { entity: 'world_cup.world_cup.goals', rows: 47 },
    { entity: 'world_cup.world_cup.teams', rows: 16 },
  ];

  /** A realistic reply: goals, their team, goals per team, sorted. */
  const REPLY = {
    steps: [
      {
        verb: 'start',
        text: 'every goal scored in the data',
        table: 'world_cup.goals',
        unit: 'goals',
      },
      {
        verb: 'add',
        text: 'the team that scored each goal',
        table: 'world_cup.teams',
        unit: 'goals',
        countSql:
          'SELECT COUNT(*) FROM world_cup.world_cup.goals g JOIN world_cup.world_cup.teams t ON t.id = g.scoring_team_id',
      },
      {
        verb: 'count',
        text: 'goals for each team',
        unit: 'teams',
        countSql:
          'SELECT COUNT(DISTINCT scoring_team_id) FROM world_cup.world_cup.goals',
      },
      {
        verb: 'sort',
        text: 'teams with the most goals first',
        unit: 'teams',
        countSql:
          'SELECT COUNT(DISTINCT scoring_team_id) FROM world_cup.world_cup.goals',
      },
    ],
  };

  function services(
    counts: (sql: string) => number | Promise<number> = (sql) =>
      sql.includes('JOIN') ? 47 : sql.includes('DISTINCT') ? 14 : 47,
  ) {
    const rerun = jest.fn((): Promise<QueryRerunResult> =>
      Promise.resolve({
        columns: ['team', 'goals'],
        rows: Array.from({ length: 14 }, (_, i) => ({
          team: `T${i}`,
          goals: 3,
        })),
        rowCount: 14,
        coverage: 'whole-table',
        ranAt: '2026-11-15T00:00:00.000Z',
      } as QueryRerunResult),
    );
    const prepare = jest.fn((answer: { evidence?: QueryEvidence[] }) =>
      Promise.resolve(
        (answer.evidence ?? []).map((entry) => ({
          ...entry,
          datasourceKind: 'postgres',
          tables: TABLES,
        })),
      ),
    );
    const countRows = jest.fn((_id: string, sql: string) =>
      Promise.resolve(counts(sql)),
    );
    const datasourceFor = jest.fn(() =>
      Promise.resolve({ id: 'ds-1', kind: 'postgres' as const }),
    );
    return {
      rerun,
      prepare,
      countRows,
      datasourceFor,
    } as unknown as ExplainerEvalServices & {
      rerun: jest.Mock;
      prepare: jest.Mock;
      countRows: jest.Mock;
    };
  }

  const stub = (reply: unknown) =>
    jest.fn(
      ({
        record,
        evidence,
      }: {
        record: ToolDataRecord;
        evidence: QueryEvidence;
      }) => Promise.resolve(explanationOf(reply, record, evidence)),
    );

  it('explains the statement as the app does and verifies the counts', async () => {
    const svc = services();
    const explain = stub(REPLY);
    const explanation = await explainForEval({
      sql: SQL,
      rationale: 'Goals scored by each team',
      datasets: ['World Cup'],
      services: svc,
      explain,
    });
    // The request holds the rationale and the statement; the rows came from a run.
    const sent = explain.mock.calls[0][0] as {
      record: { rationale: string; input: string; rowCount: number };
      evidence: QueryEvidence;
    };
    expect(sent.record).toMatchObject({
      rationale: 'Goals scored by each team',
      input: SQL,
      rowCount: 14,
    });
    expect(sent.evidence.tables).toEqual(TABLES);
    expect(svc.rerun).toHaveBeenCalledWith(
      expect.objectContaining({ input: SQL }),
      expect.objectContaining({ rowLimit: 100 }),
      ['World Cup'],
    );
    expect(explanation.stageCounts).toMatchObject({ status: 'verified' });
    expect(explanation.steps.map((s) => s.rows)).toEqual([47, 47, 14, 14, 14]);
    expect(svc.countRows).toHaveBeenCalledTimes(4);
    expect(svc.countRows).toHaveBeenCalledWith('ds-1', expect.any(String));
  });

  it('answers unverified, with the reason, when the counts fail the check', async () => {
    const explanation = await explainForEval({
      sql: SQL,
      datasets: ['World Cup'],
      services: services((sql) => (sql.includes('JOIN') ? 99 : 47)),
      explain: stub(REPLY),
    });
    expect(explanation.stageCounts?.status).toBe('unverified');
    expect(explanation.stageCounts?.reason).toBeTruthy();
  });

  it('counts nothing and says why when a step reads a table the query does not', async () => {
    const svc = services();
    const explanation = await explainForEval({
      sql: SQL,
      datasets: ['World Cup'],
      services: svc,
      explain: stub({
        steps: [
          ...REPLY.steps.slice(0, 2),
          {
            verb: 'keep',
            text: 'players born after 1990',
            countSql: 'SELECT COUNT(*) FROM world_cup.world_cup.players',
          },
        ],
      }),
    });
    expect(explanation.stageCounts?.reason).toMatch(/players/);
    expect(svc.countRows).not.toHaveBeenCalled();
  });

  it('answers unverified when a count statement fails', async () => {
    const explanation = await explainForEval({
      sql: SQL,
      datasets: ['World Cup'],
      services: services(() => {
        throw new Error('permission denied');
      }),
      explain: stub(REPLY),
    });
    expect(explanation.stageCounts).toMatchObject({
      status: 'unverified',
      reason: expect.stringContaining('permission denied') as string,
    });
  });

  it('is the answer the checks read: JSON text of the explanation', async () => {
    const agent = explainerTurnAgent(
      { id: 'query-explainer' } as unknown as Agent,
      stub(REPLY),
      rationaleOfStatement,
      () => services(),
    ) as unknown as {
      generate(
        input: string,
        options: { requestContext: { get(key: string): unknown } },
      ): Promise<{ text: string }>;
    };
    const result = await agent.generate(SQL, {
      requestContext: { get: () => ['World Cup'] },
    });
    const run = (check: { run: (i: never) => unknown }): unknown =>
      check.run({ answer: result.text } as never);
    expect(run(notFallback())).toBeUndefined();
    expect(run(startsFromATableItReads(['world_cup.goals']))).toBeUndefined();
    expect(run(textsInBusinessWords())).toBeUndefined();
    expect(run(countsVerified())).toBeUndefined();
  });

  it('loads the agent only when read, and runs each case as one explanation', () => {
    const load = jest.fn(() => ({ id: 'query-explainer' }) as unknown as Agent);
    const target = queryExplainerEvalTarget(load, jest.fn());
    expect(load).not.toHaveBeenCalled();
    expect(target.runTarget).not.toBe(target.agent);
    expect(load).toHaveBeenCalledTimes(1);
    expect(target.sendsKnowledge).toBe(false);
    expect(target.orientation({} as never)).toBe('');
  });

  it('needs the installed service, with a clear error before a model call', () => {
    installQueryExplainerEvalServices(undefined);
    expect(() => queryExplainerEvalServices()).toThrow(
      /query evidence service/,
    );
    const svc = services();
    installQueryExplainerEvalServices(svc);
    expect(queryExplainerEvalServices()).toBe(svc);
    installQueryExplainerEvalServices(undefined);
  });
});
