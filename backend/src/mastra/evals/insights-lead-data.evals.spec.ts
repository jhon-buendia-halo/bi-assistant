// The assistant's data sets, ported to Elena's target (plan
// elena-hosts-user-agents E3). The base's sets are recorded in
// `__fixtures__/emily-data-sets.json` (each case's question, reference SQL,
// rubric and scorers with their arguments, as the base built them), so the
// port is checked against what it replaced. The cases run here on her real
// target over a stand-in run service: no model, engine or store is used.
jest.mock('@mastra/core/evals', () => ({
  // As Mastra's runEvals: one generate of the target, then the item callback.
  runEvals: jest.fn(
    async (config: {
      data: { input: unknown; requestContext: unknown }[];
      target: { generate(input: unknown, options: unknown): Promise<unknown> };
      onItemComplete(item: { targetResult: unknown }): void;
    }) => {
      const [item] = config.data;
      const targetResult = await config.target.generate(item.input, {
        requestContext: item.requestContext,
      });
      config.onItemComplete({ targetResult });
      return { scores: {} };
    },
  ),
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../agents/result-explorer.agent', () => ({
  resultExplorerAgent: { id: 'result-explorer' },
  interpretResultWithModel: jest.fn(),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {
    generate: jest.fn(() =>
      Promise.resolve({ object: { pass: true, reason: 'ok' } }),
    ),
  },
  evalJudgeOutputSchema: {
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
}));
jest.mock('../model-resolver', () => ({
  resolveAgentModel: jest.fn(),
  resolveAgentModelConfig: jest.fn().mockResolvedValue('anthropic/claude-test'),
}));
const mockToolServices = {
  getDatasets: jest.fn(),
  runReadOnlySql: jest.fn(),
};
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => mockToolServices,
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { Agent } from '@mastra/core/agent';
import { evalJudgeAgent } from '../agents/eval-judge.agent';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_NAME,
} from '../agents/insights-lead-catalog';
import { runAssistantEvalCase, type AssistantEvalSet } from './assistant.evals';
import type { AveryEvalRuns, StoredAveryRun } from './avery-workflow-target';
import { EVAL_SETS, evalTargetFor, setsOfTarget } from './eval-sets';
import { INSIGHTS_LEAD_DATA_EVAL_SETS } from './insights-lead-data.evals';
import {
  INSIGHTS_LEAD_EVAL_TARGET,
  insightsLeadEvalTarget,
  type StoredInsightsLeadRun,
} from './insights-lead-target';
import { RESULT_SET_CHECK_ID } from './result-set-check';

/** A scorer of the base, with the arguments it was built with. */
interface BaseScorer {
  kind: string;
  args: (string | string[] | { regex: string; flags: string })[];
}

/** A case of the base's sets (`__fixtures__/emily-data-sets.json`). */
interface BaseCase {
  id: string;
  question: string;
  expectedSql?: string;
  resultSetOptions?: Record<string, unknown>;
  judgeRubric?: string;
  agentTools?: string[];
  scorers: BaseScorer[];
  customChecks?: string[];
}

const base = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'emily-data-sets.json'), 'utf8'),
) as { sets: { id: string; fixtureId: string; cases: BaseCase[] }[] };

/** The cases not ported, and why (see `backend/eval/README.md`). */
const DROPPED: Record<string, string> = {
  'visual-request': 'the visual designer is gone',
  'rest-visual-request': 'the visual designer is gone',
  'f1-visual-request': 'the visual designer is gone',
  'no-visuals-chart-request': 'the visual designer is gone',
  'rest-no-visuals-chart-request': 'the visual designer is gone',
  'no-clarification-best-team': "needs a user agent's draft run",
  'rest-no-clarification-best-team': "needs a user agent's draft run",
  'schema-notes-consumption': 'its staged orientation is never sent',
};

const PORTED_SET_IDS = [
  'world-cup',
  'world-cup-excel',
  'world-cup-rest',
  'formula-1',
];

/** The ported check id of a base scorer. */
function portedCheckId({ kind, args }: BaseScorer): string {
  const [arg] = args;
  if (kind === 'matches') {
    const { regex, flags } = arg as { regex: string; flags: string };
    return `answer-matches:${String(new RegExp(regex, flags))}`;
  }
  const name = arg as string;
  if (kind === 'includes') return `answer-includes:${name}`;
  // Her question is the run's wait, which `run-status` checks.
  if (kind === 'calledTool' && name === 'ask_clarification')
    return 'run-status';
  if (kind === 'calledTool') return `called-tool:${name}`;
  if (kind === 'didNotCall') return `did-not-call:${name}`;
  if (kind === 'noToolErrors') return 'no-tool-errors';
  throw new Error(`no port for the ${kind} check`);
}

/** Whether a base case asked the user (its question is ambiguous). */
function asks(evalCase: BaseCase): boolean {
  return evalCase.scorers.some(
    (scorer) =>
      scorer.kind === 'calledTool' && scorer.args[0] === 'ask_clarification',
  );
}

function portedSet(id: string): AssistantEvalSet {
  const set = INSIGHTS_LEAD_DATA_EVAL_SETS.find((s) => s.id === id);
  if (!set) throw new Error(`no ported set ${id}`);
  return set;
}

describe('the ported data sets: what they hold', () => {
  it('are the four data sets, registered on Elena and her target', () => {
    expect(INSIGHTS_LEAD_DATA_EVAL_SETS.map((set) => set.id)).toEqual(
      PORTED_SET_IDS,
    );
    for (const set of INSIGHTS_LEAD_DATA_EVAL_SETS) {
      expect(EVAL_SETS).toContain(set);
      expect(set.agentKey).toBe(INSIGHTS_LEAD_AGENT_KEY);
      expect(set.target).toBe(INSIGHTS_LEAD_EVAL_TARGET);
      expect(set.fixtureId).toBe(
        base.sets.find((baseSet) => baseSet.id === set.id)?.fixtureId,
      );
      expect(setsOfTarget(INSIGHTS_LEAD_EVAL_TARGET)).toContain(set);
    }
  });

  it('keep every base case but the dropped ones, by the same ids and in the same order', () => {
    for (const id of PORTED_SET_IDS) {
      const kept = base.sets
        .find((set) => set.id === id)!
        .cases.map((evalCase) => evalCase.id)
        .filter((caseId) => !DROPPED[caseId]);
      expect(portedSet(id).cases.map((evalCase) => evalCase.id)).toEqual(kept);
    }
    expect(
      INSIGHTS_LEAD_DATA_EVAL_SETS.flatMap((set) => set.cases),
    ).toHaveLength(35);
  });

  it('drop the visual, tool-selection and schema-notes cases everywhere in the suite', () => {
    const ids = new Set(EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id)));
    expect(Object.keys(DROPPED).filter((id) => ids.has(id))).toEqual([]);
    expect(EVAL_SETS.map((set) => set.id)).not.toContain('schema-notes');
    // Every dropped id was a base case: none is a typo.
    const baseIds = base.sets.flatMap((set) => set.cases.map((c) => c.id));
    expect(Object.keys(DROPPED).filter((id) => !baseIds.includes(id))).toEqual(
      [],
    );
  });

  it('have case ids unique across the whole suite', () => {
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('keep each case’s question, reference SQL and result-set options', () => {
    for (const id of PORTED_SET_IDS) {
      for (const baseCase of base.sets.find((s) => s.id === id)!.cases) {
        if (DROPPED[baseCase.id]) continue;
        const ported = portedSet(id).cases.find((c) => c.id === baseCase.id)!;
        expect({
          id: ported.id,
          question: ported.question,
          expectedSql: ported.expectedSql,
          resultSetOptions: ported.resultSetOptions,
        }).toEqual({
          id: baseCase.id,
          question: baseCase.question,
          expectedSql: baseCase.expectedSql,
          resultSetOptions: baseCase.resultSetOptions,
        });
      }
    }
  });

  it('keep each rubric, an ambiguous one framed as her question', () => {
    const framing =
      `The final answer is Elena's question to the user (after "${INSIGHTS_LEAD_NAME} ` +
      'asks the user:", with its options, one per line). ';
    for (const id of PORTED_SET_IDS) {
      for (const baseCase of base.sets.find((s) => s.id === id)!.cases) {
        if (DROPPED[baseCase.id]) continue;
        const ported = portedSet(id).cases.find((c) => c.id === baseCase.id)!;
        expect(ported.judgeRubric).toBe(
          baseCase.judgeRubric &&
            (asks(baseCase) ? framing : '') + baseCase.judgeRubric,
        );
      }
    }
  });

  it("turn each base scorer into its check over the stored run, after the run's status", () => {
    for (const id of PORTED_SET_IDS) {
      for (const baseCase of base.sets.find((s) => s.id === id)!.cases) {
        if (DROPPED[baseCase.id]) continue;
        const ported = portedSet(id).cases.find((c) => c.id === baseCase.id)!;
        expect(ported.scorers).toEqual([]);
        const checks = ported.customChecks ?? [];
        expect(checks.map((check) => check.id).sort()).toEqual(
          [
            ...new Set(['run-status', ...baseCase.scorers.map(portedCheckId)]),
          ].sort(),
        );
        expect(checks[0].description).toBe(
          asks(baseCase) ? 'The run ends suspended' : 'The run ends success',
        );
      }
    }
  });
});

describe('the ported data sets: they run on her target', () => {
  const agent = { id: INSIGHTS_LEAD_AGENT_KEY } as unknown as Agent;
  const datasets = ['World Cup'];

  /** Her target over a run service that answers every case with `run`. */
  function targetAnswering(run: StoredInsightsLeadRun) {
    const services = {
      run: jest.fn((): Promise<StoredAveryRun> => Promise.resolve(run)),
      remove: jest.fn(() => Promise.resolve()),
    } satisfies AveryEvalRuns;
    const target = insightsLeadEvalTarget(
      INSIGHTS_LEAD_DATA_EVAL_SETS,
      () => agent,
      () => services,
    );
    return { target, services };
  }

  function evalCase(id: string) {
    const found = INSIGHTS_LEAD_DATA_EVAL_SETS.flatMap((s) => s.cases).find(
      (c) => c.id === id,
    );
    if (!found) throw new Error(`no case ${id}`);
    return found;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolServices.getDatasets.mockResolvedValue([
      { name: 'World Cup', datasourceId: 'wc', tables: [] },
    ]);
  });

  it('is the target an Elena run of each set uses', () => {
    for (const set of INSIGHTS_LEAD_DATA_EVAL_SETS) {
      const target = evalTargetFor(INSIGHTS_LEAD_AGENT_KEY, [set.cases[0].id]);
      expect(target.agentKey).toBe(INSIGHTS_LEAD_AGENT_KEY);
      expect(target.sets).toContain(set);
      expect(target.sendsKnowledge).toBe(false);
    }
  });

  it('runs the first case of every set as one whole run of her conversation, read back and deleted', async () => {
    for (const set of INSIGHTS_LEAD_DATA_EVAL_SETS) {
      const first = set.cases[0];
      const { target, services } = targetAnswering({
        id: `run-${set.id}`,
        status: 'failed',
        error: 'stand-in',
        steps: [{ id: 'answer', toolCalls: [] }],
      });
      const result = await runAssistantEvalCase(first, datasets, target);
      expect(result.error).toBeUndefined();
      expect(services.run).toHaveBeenCalledWith({
        question: first.question,
        datasets,
      });
      expect(services.remove).toHaveBeenCalledWith(`run-${set.id}`);
      expect(
        result.checkResults.find((check) => check.id === 'run-status'),
      ).toMatchObject({
        passed: false,
        reason: 'the run ended failed: stand-in',
      });
    }
  });

  it('passes champion-2022 on a right answer, its stored records feeding the result-set check', async () => {
    const sql =
      'SELECT t.common_name AS champion FROM world_cup.tournaments x ' +
      'JOIN world_cup.teams t ON t.id = x.champion_team_id WHERE x.tournament_year = 2022';
    mockToolServices.runReadOnlySql.mockResolvedValue({
      rows: [{ champion: 'Argentina' }],
      truncated: false,
    });
    const { target } = targetAnswering({
      id: 'run-1',
      status: 'success',
      steps: [
        {
          id: 'answer',
          output: { answer: '**Argentina** won the 2022 World Cup.' },
          toolCalls: [{ tool: 'run_readonly_sql', input: sql, rowCount: 1 }],
        },
      ],
      answer: {
        content: '**Argentina** won the 2022 World Cup.',
        data: [
          {
            tool: 'run_readonly_sql',
            input: sql,
            rows: [{ champion: 'Argentina' }],
            rowCount: 1,
          },
        ],
      },
    });

    const result = await runAssistantEvalCase(
      evalCase('champion-2022'),
      datasets,
      target,
    );

    expect(
      result.checkResults.map((check) => [check.id, check.passed]),
    ).toEqual([
      [RESULT_SET_CHECK_ID, true],
      ['run-status', true],
      ['answer-includes:Argentina', true],
      ['called-tool:run_readonly_sql', true],
      ['no-tool-errors', true],
    ]);
    expect(result.passed).toBe(true);
    expect(mockToolServices.runReadOnlySql).toHaveBeenCalledWith(
      'wc',
      evalCase('champion-2022').expectedSql,
      500,
      datasets,
    );
  });

  it('fails the result-set check when her stored rows hold another champion', async () => {
    mockToolServices.runReadOnlySql.mockResolvedValue({
      rows: [{ champion: 'Argentina' }],
      truncated: false,
    });
    const { target } = targetAnswering({
      id: 'run-2',
      status: 'success',
      steps: [
        {
          id: 'answer',
          output: { answer: 'Argentina won.' },
          toolCalls: [
            { tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 1 },
          ],
        },
      ],
      answer: {
        content: 'Argentina won.',
        data: [
          {
            tool: 'run_readonly_sql',
            input: 'SELECT 1',
            rows: [{ champion: 'France' }],
            rowCount: 1,
          },
        ],
      },
    });

    const result = await runAssistantEvalCase(
      evalCase('rest-champion-2022'),
      datasets,
      target,
    );

    expect(
      result.checkResults.find((check) => check.id === RESULT_SET_CHECK_ID),
    ).toMatchObject({ passed: false });
    expect(result.passed).toBe(false);
  });

  it('passes an ambiguous case when the run waits for her question, the judge reading it', async () => {
    const { target } = targetAnswering({
      id: 'run-3',
      status: 'suspended',
      steps: [{ id: 'answer', toolCalls: [] }],
      waitingFor: {
        question: 'Best by which measure?',
        options: ['Matches won across 2018 and 2022', 'Goals scored in 2022'],
      },
    });

    const result = await runAssistantEvalCase(
      evalCase('ambiguous-best-team'),
      datasets,
      target,
    );

    expect(
      result.checkResults.map((check) => [check.id, check.passed]),
    ).toEqual([
      ['run-status', true],
      ['did-not-call:run_readonly_sql', true],
      ['no-tool-errors', true],
      ['llm-judge', true],
    ]);
    const judge = evalJudgeAgent as unknown as { generate: jest.Mock };
    const [prompt] = judge.generate.mock.calls[0] as [string];
    expect(prompt).toContain(
      `${INSIGHTS_LEAD_NAME} asks the user:\nBest by which measure?\n- Matches won across 2018 and 2022`,
    );
  });

  it('fails an ambiguous case she answers instead of asking', async () => {
    const { target } = targetAnswering({
      id: 'run-4',
      status: 'success',
      steps: [
        {
          id: 'answer',
          output: { answer: 'France won the most matches.' },
          toolCalls: [
            { tool: 'run_readonly_sql', input: 'SELECT 1', rowCount: 2 },
          ],
        },
      ],
    });

    const result = await runAssistantEvalCase(
      evalCase('f1-ambiguous-dominant-driver'),
      datasets,
      target,
    );

    expect(
      result.checkResults
        .filter((check) => !check.passed)
        .map((check) => [check.id, check.reason]),
    ).toEqual([
      ['run-status', 'the run ended success'],
      ['did-not-call:run_readonly_sql', 'she called run_readonly_sql 1 time'],
    ]);
  });
});
