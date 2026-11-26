// The cases' scorers are built at import and never run here. The stub gives
// each kind the id the real `checks` give it (`check-<kind in kebab case>`,
// so two of one kind in a case share an id), which the uniqueness test reads.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy(
    {},
    {
      get: (_target, kind: string) => () => ({
        id: `check-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      }),
    },
  ),
}));
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
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
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import {
  EVAL_SETS,
  evalSetTargetId,
  evalTargetFor,
  evalTargetIdFor,
  evalTargetOf,
  setsOfTarget,
  targetIdOfSets,
} from './eval-sets';

/**
 * Every registered set, whatever its builder: the properties the runner
 * relies on (`runEvals` keys scores by scorer id, so a repeated id loses a
 * verdict without a sound).
 */
describe('every eval set', () => {
  for (const set of EVAL_SETS) {
    describe(`set ${set.id}`, () => {
      it('has unique case ids', () => {
        const ids = set.cases.map((evalCase) => evalCase.id);
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
      });

      for (const evalCase of set.cases) {
        it(`${evalCase.id}: scorer and custom check ids are unique`, () => {
          const ids = [
            ...evalCase.scorers.map((scorer): string => scorer.id as string),
            ...(evalCase.customChecks ?? []).map((check) => check.id),
            ...(evalCase.judgeRubric ? ['judge'] : []),
          ];
          const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
          expect([...new Set(repeated)]).toEqual([]);
        });
      }
    });
  }

  it('has case ids that are unique across all sets', () => {
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe('the target a run uses', () => {
  it('is the set target, else the agent key', () => {
    expect(evalSetTargetId({ agentKey: 'result-explorer' })).toBe(
      'result-explorer',
    );
    expect(
      evalSetTargetId({
        agentKey: 'chief-of-staff',
        target: 'avery-michael-workflow',
      }),
    ).toBe('avery-michael-workflow');
  });

  it('is one id for sets of one target and an error across targets', () => {
    const chat = { agentKey: 'some-agent' };
    const check = {
      agentKey: 'some-agent',
      target: 'some-agent:workflow',
    };
    expect(targetIdOfSets([chat, chat], 'x')).toEqual({
      targetId: 'some-agent',
    });
    expect(targetIdOfSets([], 'x')).toEqual({ targetId: 'x' });
    expect(targetIdOfSets([chat, check], 'x')).toEqual({
      error:
        'The selected questions run on several targets (some-agent, some-agent:workflow) — run one set at a time',
    });
  });

  it('is the agent key for an agent whose sets are all on its own target', () => {
    expect(evalTargetIdFor('query-explainer')).toEqual({
      targetId: 'query-explainer',
    });
  });

  it('builds the whole-workflow target from its target id', () => {
    const workflow = evalTargetOf('avery-michael-workflow', 'chief-of-staff');
    expect(workflow.agentKey).toBe('chief-of-staff');
    expect(evalTargetIdFor('chief-of-staff')).toEqual({
      targetId: 'avery-michael-workflow',
    });
    // It runs the sets on its target id, through a whole-run stand-in (read
    // lazily, so the agent is not loaded here).
    expect(workflow.sets.length).toBeGreaterThan(0);
    expect(workflow.sets).toEqual(setsOfTarget('avery-michael-workflow'));
    expect(workflow.sendsKnowledge).toBe(false);
    expect('runTarget' in workflow).toBe(true);
  });

  it('still throws for an agent without evals, the removed assistant included', () => {
    expect(() => evalTargetFor('no-such-agent')).toThrow(
      'Agent "no-such-agent" has no evals to run',
    );
    expect(() => evalTargetFor('assistant')).toThrow(
      'Agent "assistant" has no evals to run',
    );
  });

  it('finds no registered set for an unregistered target', () => {
    expect(setsOfTarget('no-such-target')).toEqual([]);
  });
});
