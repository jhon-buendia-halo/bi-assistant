jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
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
import { RequestContext } from '@mastra/core/request-context';
import { findFixture } from '../../modules/testing-data/fixtures/registry';
import type { DatasetSnapshot } from '../tool-services';
import {
  INSIGHTS_ANALYST_EVAL_SET,
  INSIGHTS_ANALYST_SHARED_CONTEXT_EVAL_SET,
  INSIGHTS_ANALYST_SHARED_CONTEXT_EVAL_TARGET,
  insightsAnalystEvalTarget,
  insightsAnalystOrientationSelection,
  insightsAnalystSharedContextEvalTarget,
} from './insights-analyst.evals';
import { EVAL_SETS, agentForCases, evalTargetFor, hasEvals } from './eval-sets';
import { selectCliEvalCases } from './eval-cli-selection';

const SNAPSHOT: DatasetSnapshot = {
  name: 'World Cup',
  tables: ['world_cup.world_cup.matches'],
  datasourceKind: 'postgres',
  datasourceId: 'ds-1',
};

describe('insights-analyst eval set (agents.md 8.1)', () => {
  const cases = INSIGHTS_ANALYST_EVAL_SET.cases;

  it('runs on insights-analyst over the World Cup fixture', () => {
    expect(INSIGHTS_ANALYST_EVAL_SET.id).toBe('insights-analyst');
    expect(INSIGHTS_ANALYST_EVAL_SET.agentKey).toBe('insights-analyst');
    expect(findFixture(INSIGHTS_ANALYST_EVAL_SET.fixtureId)?.schema).toBe(
      'world_cup',
    );
  });

  it('has 8 to 12 cases with unique ids across every set', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.length).toBeLessThanOrEqual(12);
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(cases.every((c) => c.id.startsWith('v2-'))).toBe(true);
  });

  it('gives every case a question, an intent and a code or judge check', () => {
    for (const evalCase of cases) {
      expect(evalCase.question.trim()).not.toBe('');
      expect(evalCase.intent.trim()).not.toBe('');
      expect(evalCase.scorers.length).toBeGreaterThan(0);
      expect(evalCase.judgeRubric).toBeTruthy();
    }
  });

  it('keeps custom check ids unique inside each case', () => {
    for (const evalCase of cases) {
      const ids = (evalCase.customChecks ?? []).map((check) => check.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('covers every analyst skill the plan lists', () => {
    const ids = cases.map((c) => c.id).join(' ');
    for (const part of [
      'ranking-ties',
      'share',
      'compare',
      'out-of-coverage',
      'clarify',
      'no-clarify',
      'value-lookup',
      'multistep',
    ]) {
      expect(ids).toContain(part);
    }
  });

  it('asks the clarify case to ask and the fuzzy-scope case not to', () => {
    // The built-in scorers are stubs here; their wiring is read from the
    // case ids and rubrics, and the checks themselves are tested in
    // insights-analyst-eval-checks.spec.ts.
    const clarify = cases.find((c) => c.id.includes('-clarify-'));
    const noClarify = cases.find((c) => c.id.includes('-no-clarify-'));
    expect(clarify?.judgeRubric).toMatch(/ONE clarifying question/);
    expect(noClarify?.judgeRubric).toMatch(/does not ask the user/);
  });

  it('states reference SQL only against the world_cup schema', () => {
    for (const evalCase of cases) {
      if (evalCase.expectedSql) {
        expect(evalCase.expectedSql).toContain('world_cup.');
      }
    }
  });
});

describe('insights-analyst registration', () => {
  it('lists the set under the insights-analyst agent only', () => {
    expect(EVAL_SETS).toContain(INSIGHTS_ANALYST_EVAL_SET);
    expect(hasEvals('insights-analyst')).toBe(true);
    const ownCases = EVAL_SETS.filter(
      (set) => set.agentKey === 'insights-analyst',
    );
    // Its World Cup set, the Edge Cases set (story 1.29.6) and the
    // shared-context experiment's set.
    expect(ownCases.map((set) => set.id).sort()).toEqual([
      'insights-analyst',
      'insights-analyst-edge',
      'insights-analyst-shared-context',
    ]);
  });

  it('selects the set by EVAL_SET=insights-analyst', () => {
    const selection = selectCliEvalCases(
      { EVAL_SET: 'insights-analyst' },
      EVAL_SETS,
    );
    expect(selection).toEqual({
      caseIds: INSIGHTS_ANALYST_EVAL_SET.cases.map((c) => c.id),
    });
  });

  it('maps its cases to the insights-analyst agent', () => {
    expect(
      agentForCases(INSIGHTS_ANALYST_EVAL_SET.cases.map((c) => c.id)),
    ).toEqual({
      agentKey: 'insights-analyst',
    });
  });

  it('builds its target through evalTargetFor', () => {
    // Its cases name the set: the experiment's set runs on another target.
    const target = evalTargetFor(
      'insights-analyst',
      INSIGHTS_ANALYST_EVAL_SET.cases.map((c) => c.id),
    );
    expect(target.agentKey).toBe('insights-analyst');
    // The Edge Cases set (story 1.29.6) runs on the same target.
    expect(target.sets[0]).toBe(INSIGHTS_ANALYST_EVAL_SET);
    expect(target.sets.map((set) => set.id)).toEqual([
      'insights-analyst',
      'insights-analyst-edge',
    ]);
    expect((target.agent as unknown as { id: string }).id).toBe(
      'insights-analyst',
    );
  });
});

describe('insights-analyst-shared-context set (the shared-context experiment)', () => {
  const shared = INSIGHTS_ANALYST_SHARED_CONTEXT_EVAL_SET;
  const ids = () => shared.cases.map((c) => c.id);

  it('holds the Insights Analyst cases, ids prefixed shared-, the rest the same', () => {
    expect(shared.agentKey).toBe('insights-analyst');
    expect(shared.fixtureId).toBe(INSIGHTS_ANALYST_EVAL_SET.fixtureId);
    expect(shared.target).toBe('insights-analyst-shared-context');
    expect(EVAL_SETS).toContain(shared);
    expect(ids()).toEqual(
      INSIGHTS_ANALYST_EVAL_SET.cases.map((c) => `shared-${c.id}`),
    );
    shared.cases.forEach((evalCase, index) => {
      const own = INSIGHTS_ANALYST_EVAL_SET.cases[index];
      expect({ ...evalCase, id: own.id }).toEqual(own);
    });
  });

  it('is selected by EVAL_SET=insights-analyst-shared-context and runs on its own target', () => {
    expect(
      selectCliEvalCases(
        { EVAL_SET: 'insights-analyst-shared-context' },
        EVAL_SETS,
      ),
    ).toEqual({ caseIds: ids() });
    expect(agentForCases(ids())).toEqual({ agentKey: 'insights-analyst' });
    const target = evalTargetFor('insights-analyst', ids());
    expect(target.agentKey).toBe('insights-analyst');
    expect(target.sets).toEqual([shared]);
    expect(target.judgeTraceChars).toBe(12_000);
    expect(target.runTarget).not.toBe(target.agent);
  });

  it('keeps the baseline cases on the baseline target', () => {
    const baseline = evalTargetFor(
      'insights-analyst',
      INSIGHTS_ANALYST_EVAL_SET.cases.map((c) => c.id),
    );
    expect(baseline.sets.map((set) => set.id)).not.toContain(shared.id);
  });

  it("refuses a run of all the agent's questions: they span two targets", () => {
    expect(() => evalTargetFor('insights-analyst')).toThrow(
      'run one set at a time',
    );
  });

  it('runs each case in shared mode on the same agent, orientation and knowledge as the baseline', async () => {
    const agent = { id: 'insights-analyst' } as unknown as Agent;
    const wholeTurn = jest.fn(
      () => ({ id: 'shared-turn' }) as unknown as Agent,
    );
    const target = insightsAnalystSharedContextEvalTarget(
      [shared],
      () => agent,
      undefined,
      wholeTurn,
    );
    expect(target.runTarget).toEqual({ id: 'shared-turn' });
    expect(wholeTurn).toHaveBeenCalledWith(agent);
    expect(target.agent).toBe(agent);
    const baseline = insightsAnalystEvalTarget(() => agent);
    expect(target.sendsKnowledge).toBe(baseline.sendsKnowledge);
    const input = {
      datasets: ['World Cup'],
      snapshots: [SNAPSHOT],
      requestContext: new RequestContext(),
    };
    expect(await target.orientation(input)).toBe(
      await baseline.orientation(input),
    );
    expect(INSIGHTS_ANALYST_SHARED_CONTEXT_EVAL_TARGET).toBe(shared.target);
  });
});

describe('insights-analyst eval target', () => {
  const cases = () => INSIGHTS_ANALYST_EVAL_SET.cases;
  const input = {
    datasets: ['World Cup'],
    snapshots: [SNAPSHOT],
    requestContext: new RequestContext(),
  };

  it('loads the agent only when it is read', () => {
    const load = jest.fn(() => ({}) as Agent);
    const target = insightsAnalystEvalTarget(load);
    expect(load).not.toHaveBeenCalled();
    void target.agent;
    void target.agent;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('runs each case as the whole answer-business-question workflow on the agent (agents.md 8.1)', () => {
    const agent = { id: 'insights-analyst' } as unknown as Agent;
    const wholeTurn = jest.fn(() => ({ id: 'whole-turn' }) as unknown as Agent);
    const target = insightsAnalystEvalTarget(() => agent, undefined, wholeTurn);
    expect(wholeTurn).not.toHaveBeenCalled();
    expect(target.runTarget).toEqual({ id: 'whole-turn' });
    void target.runTarget;
    expect(wholeTurn).toHaveBeenCalledTimes(1);
    expect(wholeTurn).toHaveBeenCalledWith(agent);
    // The agent alone stays the target's agent (the judge and orientation).
    expect(target.agent).toBe(agent);
  });

  it('ends the clarify case on a clarifying question, before any query', () => {
    const clarify = cases().find(
      (c) => c.id === 'v2-clarify-most-dominant-team',
    );
    expect(clarify?.customChecks?.map((check) => check.id)).toEqual([
      'ends-on-clarification',
    ]);
  });

  it('gives the 3-tool agent the plain orientation and no knowledge block', async () => {
    const target = insightsAnalystEvalTarget(undefined, [
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
    ]);
    expect(target.sendsKnowledge).toBe(false);
    expect(target.judgeTraceChars).toBe(12_000);
    const text = await target.orientation(input);
    expect(text).toContain('world_cup.world_cup.matches');
    expect(text).toContain('describe_entity / run_readonly_sql');
    expect(text).not.toContain('sample_rows');
  });

  it('gives an agent with sample_rows the hint and the knowledge block', async () => {
    const names = ['list_entities', 'sample_rows', 'run_readonly_sql'];
    expect(insightsAnalystOrientationSelection(names)).toEqual(['sample_rows']);
    const target = insightsAnalystEvalTarget(undefined, names);
    expect(target.sendsKnowledge).toBe(true);
    expect(await target.orientation(input)).toContain(
      'describe_entity / sample_rows / run_readonly_sql',
    );
  });
});
